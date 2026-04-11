import type { Logger, LogObject } from '@nextnode-solutions/logger'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnrichedLogEntry } from './victorialogs-client.ts'
import { createVictoriaLogsClient } from './victorialogs-client.ts'

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

const ENTRY: EnrichedLogEntry = {
	level: 'info',
	message: 'hello',
	timestamp: '2026-04-11T10:00:00.000Z',
	client_id: 'acme',
	project: 'shop',
	tenant_tier: 'standard',
}

describe('createVictoriaLogsClient', () => {
	let sleepCalls: number[]
	const sleepImpl = (ms: number): Promise<void> => {
		sleepCalls.push(ms)
		return Promise.resolve()
	}

	beforeEach(() => {
		sleepCalls = []
	})

	it('does nothing and makes no request when entries is empty', async () => {
		const fetchImpl = vi.fn()
		const { logger } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
		})

		await client.push([])

		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('POSTs NDJSON to the endpoint with the expected Content-Type', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 204 }))
		const { logger } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
		})

		await client.push([ENTRY, { ...ENTRY, message: 'world' }])

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url, init] = fetchImpl.mock.calls[0] ?? []
		expect(url).toBe('http://vl:9428/insert/jsonline')
		expect(init?.method).toBe('POST')
		expect(init?.headers).toEqual({
			'Content-Type': 'application/stream+json',
		})
		const body = String(init?.body)
		const lines = body.split('\n')
		expect(lines).toHaveLength(2)
		expect(JSON.parse(lines[0] ?? '').message).toBe('hello')
		expect(JSON.parse(lines[1] ?? '').message).toBe('world')
	})

	it('retries on 5xx and succeeds on a later attempt', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response('boom', { status: 500 }))
			.mockResolvedValueOnce(new Response('boom', { status: 503 }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
		const { logger, calls } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
			backoffBaseMs: 100,
		})

		await client.push([ENTRY])

		expect(fetchImpl).toHaveBeenCalledTimes(3)
		expect(sleepCalls).toEqual([100, 200])
		expect(calls.filter(c => c.level === 'warn')).toHaveLength(2)
		expect(calls.filter(c => c.level === 'debug')).toHaveLength(1)
	})

	it('throws with an exhausted error after all retries fail', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('nope', { status: 502 }))
		const { logger, calls } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
			maxRetries: 3,
		})

		await expect(client.push([ENTRY])).rejects.toThrow(
			/VictoriaLogs HTTP 502/,
		)
		expect(fetchImpl).toHaveBeenCalledTimes(3)
		expect(
			calls.some(
				c =>
					c.level === 'error' &&
					c.message === 'victorialogs.push.exhausted',
			),
		).toBe(true)
	})

	it('does NOT retry on 4xx — throws after a single attempt', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response('bad', { status: 400 }))
		const { logger, calls } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
		})

		await expect(client.push([ENTRY])).rejects.toThrow(
			/VictoriaLogs HTTP 400/,
		)
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		expect(sleepCalls).toEqual([])
		expect(
			calls.some(
				c =>
					c.level === 'error' &&
					c.message === 'victorialogs.push.terminal',
			),
		).toBe(true)
	})

	it('retries on network errors (fetch rejects)', async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error('ECONNREFUSED'))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
		const { logger, calls } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
		})

		await client.push([ENTRY])

		expect(fetchImpl).toHaveBeenCalledTimes(2)
		expect(sleepCalls).toEqual([100])
		expect(
			calls.some(
				c =>
					c.level === 'warn' &&
					c.object !== undefined &&
					String(c.object['error']).includes('ECONNREFUSED'),
			),
		).toBe(true)
	})

	it('throws when fetch keeps rejecting', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('no route'))
		const { logger } = createStubLogger()
		const client = createVictoriaLogsClient({
			endpoint: 'http://vl:9428/insert/jsonline',
			logger,
			fetchImpl,
			sleepImpl,
		})

		await expect(client.push([ENTRY])).rejects.toThrow('no route')
	})
})
