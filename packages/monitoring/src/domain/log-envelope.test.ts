import { describe, expect, it } from 'vitest'

import { LOG_LEVELS, validateLogEnvelope } from './log-envelope.ts'

const VALID_ENTRY = {
	level: 'info',
	message: 'hello',
	timestamp: '2026-04-11T10:00:00.000Z',
	requestId: 'req-123',
}

function assertOk<T extends { ok: true }>(
	result: { ok: true } | { ok: false; error: string },
): asserts result is T {
	if (!result.ok) {
		expect.unreachable(`expected ok, got error: ${result.error}`)
	}
}

function assertErr<T extends { ok: false; error: string }>(
	result: { ok: true } | { ok: false; error: string },
): asserts result is T {
	if (result.ok) {
		expect.unreachable('expected error, got ok')
	}
}

describe('validateLogEnvelope', () => {
	it('accepts a minimal valid envelope', () => {
		const result = validateLogEnvelope({ logs: [VALID_ENTRY] })

		assertOk(result)
		expect(result.envelope.logs).toHaveLength(1)
		expect(result.envelope.logs[0]?.level).toBe('info')
	})

	it('accepts an empty logs array', () => {
		const result = validateLogEnvelope({ logs: [] })

		assertOk(result)
		expect(result.envelope.logs).toEqual([])
	})

	it('preserves extra fields on entries (forward-compat)', () => {
		const result = validateLogEnvelope({
			logs: [
				{
					...VALID_ENTRY,
					scope: 'auth',
					object: { userId: 42 },
					location: { file: 'a.ts', line: 10, function: 'f' },
				},
			],
		})

		assertOk(result)
		const entry = result.envelope.logs[0]
		expect(entry?.['scope']).toBe('auth')
		expect(entry?.['object']).toEqual({ userId: 42 })
		expect(entry?.['location']).toEqual({
			file: 'a.ts',
			line: 10,
			function: 'f',
		})
	})

	it.each(LOG_LEVELS)('accepts level "%s"', level => {
		const result = validateLogEnvelope({
			logs: [{ ...VALID_ENTRY, level }],
		})

		assertOk(result)
		expect(result.envelope.logs[0]?.level).toBe(level)
	})

	it.each([
		{ body: null, error: 'body must be a JSON object' },
		{ body: 'not an object', error: 'body must be a JSON object' },
		{ body: 42, error: 'body must be a JSON object' },
		{ body: [VALID_ENTRY], error: 'body must be a JSON object' },
	])('rejects non-object body ($body)', ({ body, error }) => {
		const result = validateLogEnvelope(body)

		assertErr(result)
		expect(result.error).toBe(error)
	})

	it('rejects when logs is missing', () => {
		const result = validateLogEnvelope({})

		assertErr(result)
		expect(result.error).toBe('body.logs must be an array')
	})

	it('rejects when logs is not an array', () => {
		const result = validateLogEnvelope({ logs: 'nope' })

		assertErr(result)
		expect(result.error).toBe('body.logs must be an array')
	})

	it('rejects a non-object entry', () => {
		const result = validateLogEnvelope({ logs: [VALID_ENTRY, 'string'] })

		assertErr(result)
		expect(result.error).toBe('logs[1] must be an object')
	})

	it('rejects an entry with an unknown level', () => {
		const result = validateLogEnvelope({
			logs: [{ ...VALID_ENTRY, level: 'fatal' }],
		})

		assertErr(result)
		expect(result.error).toBe(
			'logs[0].level must be one of: debug, info, warn, error',
		)
	})

	it('rejects an entry without a message', () => {
		const { message: _, ...missing } = VALID_ENTRY
		const result = validateLogEnvelope({ logs: [missing] })

		assertErr(result)
		expect(result.error).toBe('logs[0].message must be a string')
	})

	it('rejects an entry with a non-string timestamp', () => {
		const result = validateLogEnvelope({
			logs: [{ ...VALID_ENTRY, timestamp: 12345 }],
		})

		assertErr(result)
		expect(result.error).toBe('logs[0].timestamp must be a string')
	})

	it('reports the first invalid entry and stops', () => {
		const result = validateLogEnvelope({
			logs: [VALID_ENTRY, { ...VALID_ENTRY, level: 'nope' }, VALID_ENTRY],
		})

		assertErr(result)
		expect(result.error).toBe(
			'logs[1].level must be one of: debug, info, warn, error',
		)
	})
})
