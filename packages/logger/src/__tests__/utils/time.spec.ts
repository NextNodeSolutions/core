/**
 * Tests for NextNode Logger time utilities
 */

import { describe, expect, it, vi } from 'vitest'

import { getCurrentTimestamp } from '@/utils/time.js'

describe('getCurrentTimestamp', () => {
	it('should return an ISO string', () => {
		const timestamp = getCurrentTimestamp()
		expect(timestamp).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		)
	})

	it('should return valid dates', () => {
		const timestamp = getCurrentTimestamp()
		const date = new Date(timestamp)
		expect(date.getTime()).not.toBeNaN()
	})

	it('should return different timestamps when called at different times', () => {
		vi.useFakeTimers()

		const timestamp1 = getCurrentTimestamp()
		vi.advanceTimersByTime(1000) // Advance by 1 second
		const timestamp2 = getCurrentTimestamp()

		expect(timestamp1).not.toBe(timestamp2)
		vi.useRealTimers()
	})
})
