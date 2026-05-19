import { afterEach, describe, expect, it, vi } from 'vitest'

import { getEnumEnv, isEnvSet } from './env.ts'

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
		value => {
			vi.stubEnv(VAR, value)
			expect(isEnvSet(VAR)).toBe(true)
		},
	)
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
