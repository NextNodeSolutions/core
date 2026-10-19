/**
 * Tests for NextNode Logger Node.js console formatter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	formatForNode,
	resetScopeCache as resetNodeScopeCache,
} from '@/formatters/console-node.js'

import type { LogEntry } from '@/types.js'

describe('formatForNode', () => {
	let mockDate: Date
	let baseEntry: LogEntry

	beforeEach(() => {
		// Use a fixed date for consistent testing
		mockDate = new Date('2024-08-21T10:30:15.123Z')
		vi.setSystemTime(mockDate)

		// Reset scope color cache
		resetNodeScopeCache()

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

	it('should format basic info log entry', () => {
		const formatted = formatForNode(baseEntry)

		expect(formatted).toContain('🔵')
		expect(formatted).toContain('INFO')
		expect(formatted).toContain('Test message')
		expect(formatted).toContain('test.ts:42:testFunction')
		expect(formatted).toContain('req_abc12345')
		expect(formatted).toContain('10:30:15')
	})

	it('should format debug log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'debug' }
		const formatted = formatForNode(entry)

		expect(formatted).toContain('🔍')
		expect(formatted).toContain('DEBUG')
	})

	it('should format warn log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'warn' }
		const formatted = formatForNode(entry)

		expect(formatted).toContain('⚠️')
		expect(formatted).toContain('WARN')
	})

	it('should format error log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'error' }
		const formatted = formatForNode(entry)

		expect(formatted).toContain('🔴')
		expect(formatted).toContain('ERROR')
	})

	it('should include scope when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const formatted = formatForNode(entry)

		expect(formatted).toContain('[Auth]')
	})

	it('should include object properties', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: { status: 200, details: 'Simple detail' },
		}
		const formatted = formatForNode(entry)

		expect(formatted).toContain('status: 200')
		expect(formatted).toContain('details: Simple detail')
	})

	it('should handle production location format', () => {
		const entry: LogEntry = {
			...baseEntry,
			location: { function: 'testFunction' },
		}
		const formatted = formatForNode(entry)

		expect(formatted).toContain('(testFunction)')
		expect(formatted).not.toContain(':42:')
	})

	it('should handle invalid timestamp gracefully', () => {
		const entry: LogEntry = {
			...baseEntry,
			timestamp: 'invalid-timestamp',
		}
		const formatted = formatForNode(entry)

		expect(formatted).toContain('invalid-timestamp')
	})
})
