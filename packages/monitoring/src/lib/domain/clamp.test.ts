import { describe, expect, it } from 'vitest'

import { clampInteger } from '@/lib/domain/clamp.ts'

const BOUNDS = { min: 1, max: 100, fallback: 10 } as const

describe('clampInteger', () => {
	it('passes an in-range integer through unchanged', () => {
		expect(clampInteger(42, BOUNDS)).toBe(42)
	})

	it('floors a value below the minimum up to the minimum', () => {
		expect(clampInteger(-5, BOUNDS)).toBe(BOUNDS.min)
	})

	it('caps a value above the maximum down to the maximum', () => {
		expect(clampInteger(9999, BOUNDS)).toBe(BOUNDS.max)
	})

	it('falls back to the safe default for NaN', () => {
		expect(clampInteger(Number.NaN, BOUNDS)).toBe(BOUNDS.fallback)
	})

	it('falls back to the safe default for Infinity', () => {
		expect(clampInteger(Number.POSITIVE_INFINITY, BOUNDS)).toBe(
			BOUNDS.fallback,
		)
	})

	it('truncates a non-integer to an integer within bounds', () => {
		expect(clampInteger(3.9, BOUNDS)).toBe(3)
	})
})
