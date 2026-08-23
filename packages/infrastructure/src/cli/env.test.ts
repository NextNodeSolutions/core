import { afterEach, describe, expect, it, vi } from 'vitest'

import { getEnumEnv, isEnvSet, readJsonRecordEnv } from './env.ts'

const VAR = 'NEXTNODE_TEST_ENV_VAR'

describe('isEnvSet', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('returns false when the var is unset', () => {
		expect(isEnvSet(VAR)).toBe(false)
	})

	it('returns false when the var is empty', () => {
		vi.stubEnv(VAR, '')
		expect(isEnvSet(VAR)).toBe(false)
	})

	it.each(['1', 'true', 'false', '0', 'yes', 'whatever'])(
		'returns true for any non-empty value (%s)',
		candidate => {
			vi.stubEnv(VAR, candidate)
			expect(isEnvSet(VAR)).toBe(true)
		},
	)
})

describe('readJsonRecordEnv', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('returns a validated string record', () => {
		vi.stubEnv(VAR, JSON.stringify({ token: 'secret', region: 'eu' }))
		expect(readJsonRecordEnv(VAR)).toEqual({
			token: 'secret',
			region: 'eu',
		})
	})

	it.each([undefined, ''])(
		'returns an empty record when the var is %s',
		raw => {
			if (raw) vi.stubEnv(VAR, raw)
			expect(readJsonRecordEnv(VAR)).toEqual({})
		},
	)

	it('throws when JSON is malformed', () => {
		vi.stubEnv(VAR, '{not-json')
		expect(() => readJsonRecordEnv(VAR)).toThrow()
	})

	it.each([
		['an array', JSON.stringify(['secret'])],
		['null', 'null'],
		['a record with a non-string value', JSON.stringify({ token: 1 })],
	])('throws when the value is %s', (_description, raw) => {
		vi.stubEnv(VAR, raw)
		expect(() => readJsonRecordEnv(VAR)).toThrow(
			`${VAR} must be a JSON object with string values`,
		)
	})
})

describe('getEnumEnv', () => {
	const ALLOWED = ['project', 'vps'] as const

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('returns defaultValue when unset', () => {
		expect(getEnumEnv(VAR, ALLOWED, 'project')).toBe('project')
	})

	it('returns defaultValue when empty', () => {
		vi.stubEnv(VAR, '')
		expect(getEnumEnv(VAR, ALLOWED, 'project')).toBe('project')
	})

	it('returns the matching value when allowed', () => {
		vi.stubEnv(VAR, 'vps')
		expect(getEnumEnv(VAR, ALLOWED, 'project')).toBe('vps')
	})

	it('throws on unknown value listing allowed values', () => {
		vi.stubEnv(VAR, 'full')
		expect(() => getEnumEnv(VAR, ALLOWED, 'project')).toThrow(
			new RegExp(`Invalid ${VAR} "full".*project, vps`),
		)
	})
})
