import { describe, expect, it } from 'vitest'

import {
	validateEnvironmentSection,
	validateScriptsSection,
} from './pipeline.ts'

describe('validateScriptsSection', () => {
	it('returns defaults when the section is undefined', () => {
		const validation = validateScriptsSection(undefined)

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section).toEqual({
			lint: 'lint',
			test: 'test',
			build: 'build',
		})
	})

	it('accepts custom script names', () => {
		const validation = validateScriptsSection({
			lint: 'check:lint',
			test: 'check:test',
			build: 'compile',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section).toEqual({
			lint: 'check:lint',
			test: 'check:test',
			build: 'compile',
		})
	})

	it('accepts false to disable a script', () => {
		const validation = validateScriptsSection({ test: false })

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.test).toBe(false)
	})

	it('rejects non-table section', () => {
		const validation = validateScriptsSection('not a table')

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain('[scripts] must be a table')
	})

	it.each([
		['lint', 42, 'number'],
		['test', {}, 'object'],
		['build', [], 'object'],
	] as const)(
		'rejects %s when value is %j (type %s)',
		(key, scriptValue, typeName) => {
			const validation = validateScriptsSection({ [key]: scriptValue })

			expect(validation.ok).toBe(false)
			if (validation.ok) return
			expect(validation.errors).toContain(
				`scripts.${key} must be a string or false, got ${typeName}`,
			)
		},
	)
})

describe('validateEnvironmentSection', () => {
	it('defaults development to true when the section is undefined', () => {
		const validation = validateEnvironmentSection(undefined)

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.development).toBe(true)
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
		const validation = validateEnvironmentSection('not a table')

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain('[environment] must be a table')
	})

	it('rejects non-boolean development value', () => {
		const validation = validateEnvironmentSection({ development: 'yes' })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'environment.development must be a boolean',
		)
	})
})
