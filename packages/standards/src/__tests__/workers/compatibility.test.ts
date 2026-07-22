import { describe, expect, it } from 'vitest'

import {
	WORKERS_COMPATIBILITY_DATE,
	WORKERS_COMPATIBILITY_FLAGS,
	buildWranglerDevArgs,
	isRuntimeCompatible,
	parseWorkerdCompatibilityDate,
} from '../../workers/compatibility.js'

describe('parseWorkerdCompatibilityDate', () => {
	it('derives the ISO date from a workerd version', () => {
		expect(parseWorkerdCompatibilityDate('1.20260714.1')).toBe('2026-07-14')
	})

	it('throws on an unrecognized version string', () => {
		expect(() => parseWorkerdCompatibilityDate('4.112.0')).toThrow(
			/Unrecognized workerd version/,
		)
	})
})

describe('isRuntimeCompatible', () => {
	it('accepts a runtime whose date equals the required date', () => {
		expect(isRuntimeCompatible('2026-07-14', '2026-07-14')).toBe(true)
	})

	it('accepts a runtime newer than the required date', () => {
		expect(isRuntimeCompatible('2026-08-01', '2026-07-14')).toBe(true)
	})

	it('rejects a runtime older than the required date', () => {
		expect(isRuntimeCompatible('2026-06-01', '2026-07-14')).toBe(false)
	})
})

describe('buildWranglerDevArgs', () => {
	it('prepends the dev subcommand and appends compat date + flags', () => {
		expect(
			buildWranglerDevArgs(
				['src/index.ts', '--port', '8787'],
				'2026-07-14',
				['nodejs_compat'],
			),
		).toEqual([
			'dev',
			'src/index.ts',
			'--port',
			'8787',
			'--compatibility-date',
			'2026-07-14',
			'--compatibility-flags',
			'nodejs_compat',
		])
	})

	it('omits the flag group when no flags are pinned', () => {
		expect(buildWranglerDevArgs([], '2026-07-14', [])).toEqual([
			'dev',
			'--compatibility-date',
			'2026-07-14',
		])
	})
})

describe('fleet constants', () => {
	it('pins an ISO compatibility date', () => {
		expect(WORKERS_COMPATIBILITY_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
	})

	it('enables nodejs_compat', () => {
		expect(WORKERS_COMPATIBILITY_FLAGS).toContain('nodejs_compat')
	})
})
