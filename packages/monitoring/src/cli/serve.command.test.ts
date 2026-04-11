import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Logger } from '@nextnode-solutions/logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildServeContext } from './serve.command.ts'

const noop = (): void => {}

function createStubLogger(): Logger {
	const logger: Logger = {
		debug: noop,
		info: noop,
		warn: noop,
		error: noop,
		child: (): Logger => logger,
	}
	return logger
}

describe('buildServeContext', () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'nn-monitor-serve-'))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	it('wires a token, rate-limited, VL-forwarding ingest pipeline end-to-end', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 204 }))
		const ctx = buildServeContext({
			dbPath: join(tempDir, 'tokens.db'),
			vlUrl: 'http://vl:9428/insert/jsonline',
			logger: createStubLogger(),
			fetchImpl,
		})

		const { plaintext } = ctx.tokenStore.create({
			clientId: 'acme',
			project: 'shop',
			tier: 'standard',
		})

		const res = await ctx.app.request('/ingest/logs', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${plaintext}`,
			},
			body: JSON.stringify({
				logs: [
					{
						level: 'info',
						message: 'hi',
						timestamp: '2026-04-11T10:00:00.000Z',
					},
				],
			}),
		})

		ctx.close()

		expect(res.status).toBe(204)
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = fetchImpl.mock.calls[0] ?? []
		expect(url).toBe('http://vl:9428/insert/jsonline')
		const body = String(init?.body)
		expect(body).toContain('"client_id":"acme"')
		expect(body).toContain('"project":"shop"')
		expect(body).toContain('"tenant_tier":"standard"')
	})

	it('responds to GET /health without any dependency check', async () => {
		const ctx = buildServeContext({
			dbPath: join(tempDir, 'tokens.db'),
			vlUrl: 'http://vl:9428/insert/jsonline',
			logger: createStubLogger(),
		})

		const res = await ctx.app.request('/health')
		ctx.close()

		expect(res.status).toBe(204)
	})

	it('responds 204 on GET /ready when readiness always resolves true', async () => {
		const ctx = buildServeContext({
			dbPath: join(tempDir, 'tokens.db'),
			vlUrl: 'http://vl:9428/insert/jsonline',
			logger: createStubLogger(),
		})

		const res = await ctx.app.request('/ready')
		ctx.close()

		expect(res.status).toBe(204)
	})
})
