/**
 * Tests for NextNode Logger formatters
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	formatForBrowser,
	resetScopeCache as resetBrowserScopeCache,
} from '@/formatters/console-browser.js'
import {
	formatForNode,
	resetScopeCache as resetNodeScopeCache,
} from '@/formatters/console-node.js'
import { formatAsJson, formatAsJsonPretty } from '@/formatters/json.js'
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
		const result = formatForNode(baseEntry)

		expect(result).toContain('🔵')
		expect(result).toContain('INFO')
		expect(result).toContain('Test message')
		expect(result).toContain('test.ts:42:testFunction')
		expect(result).toContain('req_abc12345')
		expect(result).toContain('10:30:15')
	})

	it('should format debug log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'debug' }
		const result = formatForNode(entry)

		expect(result).toContain('🔍')
		expect(result).toContain('DEBUG')
	})

	it('should format warn log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'warn' }
		const result = formatForNode(entry)

		expect(result).toContain('⚠️')
		expect(result).toContain('WARN')
	})

	it('should format error log entry', () => {
		const entry: LogEntry = { ...baseEntry, level: 'error' }
		const result = formatForNode(entry)

		expect(result).toContain('🔴')
		expect(result).toContain('ERROR')
	})

	it('should include scope when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const result = formatForNode(entry)

		expect(result).toContain('[Auth]')
	})

	it('should include object properties', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: { status: 200, details: 'Simple detail' },
		}
		const result = formatForNode(entry)

		expect(result).toContain('status: 200')
		expect(result).toContain('details: Simple detail')
	})

	it('should handle production location format', () => {
		const entry: LogEntry = {
			...baseEntry,
			location: { function: 'testFunction' },
		}
		const result = formatForNode(entry)

		expect(result).toContain('(testFunction)')
		expect(result).not.toContain(':42:')
	})

	it('should handle invalid timestamp gracefully', () => {
		const entry: LogEntry = {
			...baseEntry,
			timestamp: 'invalid-timestamp',
		}
		const result = formatForNode(entry)

		expect(result).toContain('invalid-timestamp')
	})
})

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
		const result = formatForBrowser(baseEntry)

		expect(result).toHaveProperty('format')
		expect(result).toHaveProperty('styles')
		expect(result).toHaveProperty('objects')
		expect(Array.isArray(result.styles)).toBe(true)
		expect(Array.isArray(result.objects)).toBe(true)
	})

	it('should include emoji in format', () => {
		const result = formatForBrowser(baseEntry)

		expect(result.format).toContain('🔵')
	})

	it('should include message in format', () => {
		const result = formatForBrowser(baseEntry)

		expect(result.format).toContain('Test message')
	})

	it('should include scope in format when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const result = formatForBrowser(entry)

		expect(result.format).toContain('[Auth]')
	})

	it('should pass objects directly for DevTools inspection', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: { status: 200, details: { userId: 123 } },
		}
		const result = formatForBrowser(entry)

		expect(result.objects).toHaveLength(1)
		expect(result.objects[0]).toEqual({
			status: 200,
			details: { userId: 123 },
		})
	})

	it('should have empty objects array when no object present', () => {
		const result = formatForBrowser(baseEntry)

		expect(result.objects).toHaveLength(0)
	})
})

describe('formatAsJson', () => {
	let mockDate: Date
	let baseEntry: LogEntry

	beforeEach(() => {
		mockDate = new Date('2024-08-21T10:30:15.123Z')
		vi.setSystemTime(mockDate)

		baseEntry = {
			level: 'info',
			message: 'Test message',
			timestamp: mockDate.toISOString(),
			location: { function: 'testFunction' },
			requestId: 'req_abc12345',
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('should format basic log entry as JSON', () => {
		const result = formatAsJson(baseEntry)
		const parsed = JSON.parse(result)

		expect(parsed.level).toBe('info')
		expect(parsed.message).toBe('Test message')
		expect(parsed.timestamp).toBe('2024-08-21T10:30:15.123Z')
		expect(parsed.location).toEqual({ function: 'testFunction' })
		expect(parsed.requestId).toBe('req_abc12345')
	})

	it('should include scope when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const result = formatAsJson(entry)
		const parsed = JSON.parse(result)

		expect(parsed.scope).toBe('Auth')
	})

	it('should flatten object properties into root', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: {
				status: 200,
				details: { userId: 123 },
			},
		}
		const result = formatAsJson(entry)
		const parsed = JSON.parse(result)

		expect(parsed.status).toBe(200)
		expect(parsed.details).toEqual({ userId: 123 })
	})

	it('should not include undefined object properties', () => {
		const entry: LogEntry = {
			...baseEntry,
			object: {
				status: 200,
				details: undefined,
			},
		}
		const result = formatAsJson(entry)
		const parsed = JSON.parse(result)

		expect(parsed.status).toBe(200)
		expect(parsed).not.toHaveProperty('details')
	})

	it.each([
		['debug' as const],
		['info' as const],
		['warn' as const],
		['error' as const],
	])('should produce valid JSON for %s level', level => {
		const entry: LogEntry = { ...baseEntry, level }
		const result = formatAsJson(entry)

		expect(() => JSON.parse(result)).not.toThrow()
		const parsed = JSON.parse(result)
		expect(parsed.level).toBe(level)
	})
})

describe('formatAsJsonPretty', () => {
	let mockDate: Date
	let baseEntry: LogEntry

	beforeEach(() => {
		mockDate = new Date('2024-08-21T10:30:15.123Z')
		vi.setSystemTime(mockDate)

		baseEntry = {
			level: 'info',
			message: 'Test message',
			timestamp: mockDate.toISOString(),
			location: { function: 'testFunction' },
			requestId: 'req_abc12345',
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('should produce multi-line JSON', () => {
		const result = formatAsJsonPretty(baseEntry)

		expect(result).toContain('\n')
		expect(result).toContain('  ') // Indentation
	})

	it('should be parseable as JSON', () => {
		const result = formatAsJsonPretty(baseEntry)

		expect(() => JSON.parse(result)).not.toThrow()
	})
})

describe('JSON Formatter Security', () => {
	let mockDate: Date
	let baseEntry: LogEntry

	beforeEach(() => {
		mockDate = new Date('2024-08-21T10:30:15.123Z')
		vi.setSystemTime(mockDate)

		baseEntry = {
			level: 'info',
			message: 'Test message',
			timestamp: mockDate.toISOString(),
			location: { function: 'testFunction' },
			requestId: 'req_abc12345',
		}
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('Prototype Pollution Prevention', () => {
		it('should filter out __proto__ key from object', () => {
			const entry: LogEntry = {
				...baseEntry,
				object: {
					normalKey: 'value',
					__proto__: { polluted: true },
				},
			}
			const result = formatAsJson(entry)
			const parsed = JSON.parse(result)

			expect(parsed.normalKey).toBe('value')
			// Check that __proto__ is not an own property of the parsed object
			expect(Object.hasOwn(parsed, '__proto__')).toBe(false)
		})

		it('should filter out constructor key from object', () => {
			const entry: LogEntry = {
				...baseEntry,
				object: {
					normalKey: 'value',
					constructor: { polluted: true },
				},
			}
			const result = formatAsJson(entry)
			const parsed = JSON.parse(result)

			expect(parsed.normalKey).toBe('value')
			expect(parsed).not.toHaveProperty('constructor')
		})

		it('should filter out prototype key from object', () => {
			const entry: LogEntry = {
				...baseEntry,
				object: {
					normalKey: 'value',
					prototype: { polluted: true },
				},
			}
			const result = formatAsJson(entry)
			const parsed = JSON.parse(result)

			expect(parsed.normalKey).toBe('value')
			expect(parsed).not.toHaveProperty('prototype')
		})

		it('should allow normal keys while filtering dangerous ones', () => {
			const entry: LogEntry = {
				...baseEntry,
				object: {
					status: 200,
					userId: 123,
					__proto__: { evil: true },
					constructor: { evil: true },
					prototype: { evil: true },
					data: { nested: 'value' },
				},
			}
			const result = formatAsJson(entry)
			const parsed = JSON.parse(result)

			// Normal keys should be present
			expect(parsed.status).toBe(200)
			expect(parsed.userId).toBe(123)
			expect(parsed.data).toEqual({ nested: 'value' })

			// Dangerous keys should be filtered
			expect(Object.keys(parsed)).not.toContain('__proto__')
			expect(Object.keys(parsed)).not.toContain('constructor')
			expect(Object.keys(parsed)).not.toContain('prototype')
		})

		it('should apply same filtering in formatAsJsonPretty', () => {
			const entry: LogEntry = {
				...baseEntry,
				object: {
					normalKey: 'value',
					__proto__: { polluted: true },
					constructor: { polluted: true },
				},
			}
			const result = formatAsJsonPretty(entry)
			const parsed = JSON.parse(result)

			expect(parsed.normalKey).toBe('value')
			expect(Object.keys(parsed)).not.toContain('__proto__')
			expect(Object.keys(parsed)).not.toContain('constructor')
		})
	})
})
