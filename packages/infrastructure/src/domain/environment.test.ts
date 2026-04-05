import { describe, expect, it } from 'vitest'

import { resolveEnvironment } from './environment.ts'

describe('resolveEnvironment', () => {
	it('returns "none" for package projects regardless of env var', () => {
		expect(resolveEnvironment('package', undefined)).toBe('none')
		expect(resolveEnvironment('package', 'production')).toBe('none')
	})

	it('returns the raw env for app projects when valid', () => {
		expect(resolveEnvironment('app', 'development')).toBe('development')
		expect(resolveEnvironment('app', 'production')).toBe('production')
	})

	it('returns the raw env for static projects when valid', () => {
		expect(resolveEnvironment('static', 'development')).toBe('development')
		expect(resolveEnvironment('static', 'production')).toBe('production')
	})

	it('throws when env var is missing for app projects', () => {
		expect(() => resolveEnvironment('app', undefined)).toThrow(
			'PIPELINE_ENVIRONMENT must be one of development, production',
		)
	})

	it('throws when env var is invalid for app projects', () => {
		expect(() => resolveEnvironment('app', 'staging')).toThrow(
			'PIPELINE_ENVIRONMENT must be one of development, production for app projects (got: staging)',
		)
	})

	it('throws when env var is empty string for app projects', () => {
		expect(() => resolveEnvironment('app', '')).toThrow(
			'PIPELINE_ENVIRONMENT must be one of',
		)
	})

	it('throws for static projects with invalid env', () => {
		expect(() => resolveEnvironment('static', 'nope')).toThrow(
			'PIPELINE_ENVIRONMENT must be one of development, production for static projects (got: nope)',
		)
	})
})
