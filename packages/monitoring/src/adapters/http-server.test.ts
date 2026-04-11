import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Logger, LogObject } from '@nextnode-solutions/logger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createHttpServer } from './http-server.ts'
import { createRateLimiterStore } from './rate-limiter-store.ts'
import type { TokenStore } from './token-store.ts'
import { openTokenStore } from './token-store.ts'
import type {
	EnrichedLogEntry,
	VictoriaLogsClient,
} from './victorialogs-client.ts'

interface LoggedCall {
	readonly level: 'debug' | 'info' | 'warn' | 'error'
	readonly message: string
	readonly object: LogObject | undefined
}

function createStubLogger(): { logger: Logger; calls: LoggedCall[] } {
	const calls: LoggedCall[] = []
	const record =
		(level: LoggedCall['level']) =>
		(message: string, object?: LogObject): void => {
			calls.push({ level, message, object })
		}
	const logger: Logger = {
		debug: record('debug'),
		info: record('info'),
		warn: record('warn'),
		error: record('error'),
		child: (): Logger => logger,
	}
	return { logger, calls }
}

interface StubVlClient extends VictoriaLogsClient {
	readonly pushes: Array<ReadonlyArray<EnrichedLogEntry>>
	failure: Error | null
}

function createStubVlClient(): StubVlClient {
	const pushes: Array<ReadonlyArray<EnrichedLogEntry>> = []
	const stub: StubVlClient = {
		pushes,
		failure: null,
		async push(entries) {
			if (stub.failure !== null) throw stub.failure
			pushes.push(entries)
		},
	}
	return stub
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readErrorPayload(res: Response): Promise<string> {
	const payload: unknown = await res.json()
	if (!isRecord(payload)) {
		expect.unreachable('expected JSON object response body')
	}
	const error = payload['error']
	if (typeof error !== 'string') {
		expect.unreachable('expected payload.error to be a string')
	}
	return error
}

const VALID_LOG = {
	level: 'info',
	message: 'hello',
	timestamp: '2026-04-11T10:00:00.000Z',
}

describe('createHttpServer', () => {
	let tempDir: string
	let tokenStore: TokenStore
	let vlClient: StubVlClient
	let now: number
	const clock = (): number => now
	let logger: Logger
	let calls: LoggedCall[]
	let readiness: boolean
	let app: ReturnType<typeof createHttpServer>
	let validToken: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'nn-monitor-http-'))
		tokenStore = openTokenStore(join(tempDir, 'tokens.db'))
		const created = tokenStore.create({
			clientId: 'acme',
			project: 'shop',
			tier: 'standard',
		})
		validToken = created.plaintext

		vlClient = createStubVlClient()
		now = 1_700_000_000_000
		const rateLimiter = createRateLimiterStore({ clock })
		const stub = createStubLogger()
		logger = stub.logger
		calls = stub.calls
		readiness = true
		app = createHttpServer({
			tokenStore,
			rateLimiter,
			vlClient,
			logger,
			readinessCheck: () => Promise.resolve(readiness),
		})
	})

	afterEach(() => {
		tokenStore.close()
		rmSync(tempDir, { recursive: true, force: true })
	})

	async function postIngest(
		body: unknown,
		headers: Record<string, string> = {},
	): Promise<Response> {
		return await app.request('/ingest/logs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${validToken}`,
				...headers,
			},
			body: typeof body === 'string' ? body : JSON.stringify(body),
		})
	}

	describe('GET /health', () => {
		it('always returns 204 (no dep checks)', async () => {
			const res = await app.request('/health')
			expect(res.status).toBe(204)
		})
	})

	describe('GET /ready', () => {
		it('returns 204 when readinessCheck resolves true', async () => {
			const res = await app.request('/ready')
			expect(res.status).toBe(204)
		})

		it('returns 503 when readinessCheck resolves false', async () => {
			readiness = false
			const res = await app.request('/ready')
			expect(res.status).toBe(503)
		})
	})

	describe('POST /ingest/logs — auth', () => {
		it('returns 401 when the Authorization header is missing', async () => {
			const res = await app.request('/ingest/logs', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ logs: [VALID_LOG] }),
			})

			expect(res.status).toBe(401)
			expect(
				calls.some(
					c =>
						c.level === 'warn' &&
						c.message === 'ingest.auth.missing',
				),
			).toBe(true)
		})

		it('returns 401 when the Authorization header lacks the Bearer prefix', async () => {
			const res = await postIngest(
				{ logs: [VALID_LOG] },
				{ Authorization: validToken },
			)

			expect(res.status).toBe(401)
		})

		it('returns 401 when the bearer token is unknown', async () => {
			const res = await postIngest(
				{ logs: [VALID_LOG] },
				{ Authorization: 'Bearer nn_live_wrong' },
			)

			expect(res.status).toBe(401)
			expect(
				calls.some(
					c =>
						c.level === 'warn' &&
						c.message === 'ingest.auth.invalid',
				),
			).toBe(true)
		})

		it('returns 401 for a revoked tenant', async () => {
			const second = tokenStore.create({
				clientId: 'globex',
				project: 'web',
				tier: 'standard',
			})
			tokenStore.revoke(second.tenant.id)

			const res = await postIngest(
				{ logs: [VALID_LOG] },
				{ Authorization: `Bearer ${second.plaintext}` },
			)

			expect(res.status).toBe(401)
		})
	})

	describe('POST /ingest/logs — validation', () => {
		it('returns 400 on malformed JSON', async () => {
			const res = await postIngest('{not json')

			expect(res.status).toBe(400)
			expect(
				calls.some(
					c =>
						c.level === 'warn' &&
						c.message === 'ingest.body.parse_error',
				),
			).toBe(true)
		})

		it('returns 400 when the envelope shape is invalid', async () => {
			const res = await postIngest({ logs: 'nope' })

			expect(res.status).toBe(400)
			expect(await readErrorPayload(res)).toBe(
				'body.logs must be an array',
			)
		})

		it('returns 400 when an entry is missing a required field', async () => {
			const res = await postIngest({
				logs: [{ level: 'info', message: 'no timestamp' }],
			})

			expect(res.status).toBe(400)
		})
	})

	describe('POST /ingest/logs — rate limiting', () => {
		it('returns 429 with a Retry-After header once the limit is saturated', async () => {
			// Standard tier = 60 rpm. Saturate it.
			for (let i = 0; i < 60; i++) {
				const ok = await postIngest({ logs: [VALID_LOG] })
				expect(ok.status).toBe(204)
			}

			const res = await postIngest({ logs: [VALID_LOG] })
			expect(res.status).toBe(429)
			expect(res.headers.get('Retry-After')).not.toBeNull()
			expect(
				calls.some(
					c =>
						c.level === 'warn' &&
						c.message === 'ingest.rate_limit.exceeded',
				),
			).toBe(true)
		})
	})

	describe('POST /ingest/logs — happy path', () => {
		it('returns 204 and forwards enriched logs to VictoriaLogs', async () => {
			const res = await postIngest({
				logs: [VALID_LOG, { ...VALID_LOG, message: 'second' }],
			})

			expect(res.status).toBe(204)
			expect(vlClient.pushes).toHaveLength(1)
			const pushed = vlClient.pushes[0] ?? []
			expect(pushed).toHaveLength(2)
			const first = pushed[0]
			expect(first?.client_id).toBe('acme')
			expect(first?.project).toBe('shop')
			expect(first?.tenant_tier).toBe('standard')
			expect(first?.message).toBe('hello')
		})

		it('logs ingest.ok with tenantId and count on success', async () => {
			await postIngest({ logs: [VALID_LOG] })

			const infoCall = calls.find(c => c.message === 'ingest.ok')
			expect(infoCall).toBeDefined()
			expect(infoCall?.object?.['count']).toBe(1)
		})
	})

	describe('POST /ingest/logs — VictoriaLogs failure', () => {
		it('returns 503 and logs an error (does not swallow)', async () => {
			vlClient.failure = new Error('VictoriaLogs HTTP 502: Bad Gateway')

			const res = await postIngest({ logs: [VALID_LOG] })

			expect(res.status).toBe(503)
			expect(await readErrorPayload(res)).toBe('unable to forward logs')
			expect(
				calls.some(
					c =>
						c.level === 'error' &&
						c.message === 'ingest.forward.failed',
				),
			).toBe(true)
		})
	})
})
