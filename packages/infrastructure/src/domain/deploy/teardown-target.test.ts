import { describe, expect, it } from 'vitest'

import { validateTeardownOptions } from './teardown-target.ts'

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
