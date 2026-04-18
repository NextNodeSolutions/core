import { describe, expect, it } from 'vitest'

import { parseTeardownTarget } from './teardown-target.ts'

describe('parseTeardownTarget', () => {
	it('defaults to project when value is undefined', () => {
		expect(parseTeardownTarget(undefined)).toBe('project')
	})

	it('defaults to project when value is empty', () => {
		expect(parseTeardownTarget('')).toBe('project')
	})

	it('returns project when value is "project"', () => {
		expect(parseTeardownTarget('project')).toBe('project')
	})

	it('returns vps when value is "vps"', () => {
		expect(parseTeardownTarget('vps')).toBe('vps')
	})

	it('throws on unknown value', () => {
		expect(() => parseTeardownTarget('full')).toThrow(
			/Invalid TEARDOWN_TARGET "full"/,
		)
	})
})
