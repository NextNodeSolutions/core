/**
 * Tests for NextNode Logger browser console formatter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	formatForBrowser,
	resetScopeCache as resetBrowserScopeCache,
} from '@/formatters/console-browser.js'

import type { LogEntry } from '@/types.js'

describe('formatForBrowser', () => {
	let mockDate: Date
	let baseEntry: LogEntry

	beforeEach(() => {
		mockDate = new Date('2024-08-21T10:30:15.123Z')
		vi.setSystemTime(mockDate)

		resetBrowserScopeCache()

		baseEntry = {
			level: 'info',
			message: 'Test message',
			timestamp: mockDate.toISOString(),
			location: { file: 'test.ts', line: 42, function: 'testFunction' },
			requestId: 'req_abc12345',
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('should return format string and styles', () => {
		const formatted = formatForBrowser(baseEntry)

		expect(formatted).toHaveProperty('format')
		expect(formatted).toHaveProperty('styles')
		expect(formatted).toHaveProperty('objects')
		expect(Array.isArray(formatted.styles)).toBe(true)
		expect(Array.isArray(formatted.objects)).toBe(true)
	})

	it('should include emoji in format', () => {
		const formatted = formatForBrowser(baseEntry)

		expect(formatted.format).toContain('🔵')
	})

	it('should include message in format', () => {
		const formatted = formatForBrowser(baseEntry)

		expect(formatted.format).toContain('Test message')
	})

	it('should include scope in format when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const formatted = formatForBrowser(entry)

		expect(formatted.format).toContain('[Auth]')
	})

	it('should pass objects directly for DevTools inspection', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: { status: 200, details: { userId: 123 } },
		}
		const formatted = formatForBrowser(entry)

		expect(formatted.objects).toHaveLength(1)
		expect(formatted.objects[0]).toEqual({
			status: 200,
			details: { userId: 123 },
		})
	})

	it('should have empty objects array when no object present', () => {
		const formatted = formatForBrowser(baseEntry)

		expect(formatted.objects).toHaveLength(0)
	})
})
