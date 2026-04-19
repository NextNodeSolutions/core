import { describe, expect, it } from 'vitest'

import {
	validateEnvironmentSection,
	validateScriptsSection,
} from './pipeline.ts'

describe('validateScriptsSection', () => {
	it('returns defaults when the section is undefined', () => {
		const result = validateScriptsSection(undefined)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({
			lint: 'lint',
			test: 'test',
			build: 'build',
		})
	})

	it('accepts custom script names', () => {
		const result = validateScriptsSection({
			lint: 'check:lint',
			test: 'check:test',
			build: 'compile',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({
			lint: 'check:lint',
			test: 'check:test',
			build: 'compile',
		})
	})

	it('accepts false to disable a script', () => {
		const result = validateScriptsSection({ test: false })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.test).toBe(false)
	})

	it('rejects non-table section', () => {
		const result = validateScriptsSection('not a table')

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain('[scripts] must be a table')
	})

	it.each([
		['lint', 42, 'number'],
		['test', {}, 'object'],
		['build', [], 'object'],
	] as const)(
		'rejects %s when value is %j (type %s)',
		(key, value, typeName) => {
			const result = validateScriptsSection({ [key]: value })

			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(result.errors).toContain(
				`scripts.${key} must be a string or false, got ${typeName}`,
			)
		},
	)
})

describe('validateEnvironmentSection', () => {
	it('defaults development to true when the section is undefined', () => {
		const result = validateEnvironmentSection(undefined)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.development).toBe(true)
	})

	it('accepts development explicitly set', () => {
		expect(validateEnvironmentSection({ development: true })).toEqual({
			ok: true,
			section: { development: true },
		})
		expect(validateEnvironmentSection({ development: false })).toEqual({
			ok: true,
			section: { development: false },
		})
	})

	it('rejects non-table section', () => {
		const result = validateEnvironmentSection('not a table')

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain('[environment] must be a table')
	})

	it('rejects non-boolean development value', () => {
		const result = validateEnvironmentSection({ development: 'yes' })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'environment.development must be a boolean',
		)
	})
})
