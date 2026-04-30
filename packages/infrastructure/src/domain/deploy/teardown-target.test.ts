import { describe, expect, it } from 'vitest'

import {
	parseTeardownTarget,
	parseTeardownWithVolumes,
	validateTeardownOptions,
} from './teardown-target.ts'

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

describe('parseTeardownWithVolumes', () => {
	it('defaults to false when value is undefined', () => {
		expect(parseTeardownWithVolumes(undefined)).toBe(false)
	})

	it('defaults to false when value is empty', () => {
		expect(parseTeardownWithVolumes('')).toBe(false)
	})

	it('returns true for "true"', () => {
		expect(parseTeardownWithVolumes('true')).toBe(true)
	})

	it('returns true for "1"', () => {
		expect(parseTeardownWithVolumes('1')).toBe(true)
	})

	it('returns false for "false"', () => {
		expect(parseTeardownWithVolumes('false')).toBe(false)
	})

	it('returns false for "0"', () => {
		expect(parseTeardownWithVolumes('0')).toBe(false)
	})

	it('throws on unknown value', () => {
		expect(() => parseTeardownWithVolumes('yes')).toThrow(
			/Invalid TEARDOWN_WITH_VOLUMES "yes"/,
		)
	})
})

describe('validateTeardownOptions', () => {
	it('accepts any combination for app projects', () => {
		expect(() =>
			validateTeardownOptions('app', 'project', false),
		).not.toThrow()
		expect(() =>
			validateTeardownOptions('app', 'project', true),
		).not.toThrow()
		expect(() => validateTeardownOptions('app', 'vps', false)).not.toThrow()
		expect(() => validateTeardownOptions('app', 'vps', true)).not.toThrow()
	})

	it('accepts project + withVolumes=false for static projects', () => {
		expect(() =>
			validateTeardownOptions('static', 'project', false),
		).not.toThrow()
	})

	it('rejects vps scope for static projects', () => {
		expect(() => validateTeardownOptions('static', 'vps', false)).toThrow(
			/TEARDOWN_TARGET="vps" is not supported for static deploys/,
		)
	})

	it('rejects withVolumes=true for static projects', () => {
		expect(() =>
			validateTeardownOptions('static', 'project', true),
		).toThrow(
			/TEARDOWN_WITH_VOLUMES=true is not supported for static deploys/,
		)
	})
})
