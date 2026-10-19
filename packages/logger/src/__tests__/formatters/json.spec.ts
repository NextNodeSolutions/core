/**
 * Tests for NextNode Logger JSON formatter
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatAsJson, formatAsJsonPretty } from '@/formatters/json.js'

import type { LogEntry } from '@/types.js'

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
		const formatted = formatAsJson(baseEntry)
		const parsed = JSON.parse(formatted)

		expect(parsed.level).toBe('info')
		expect(parsed.message).toBe('Test message')
		expect(parsed.timestamp).toBe('2024-08-21T10:30:15.123Z')
		expect(parsed.location).toEqual({ function: 'testFunction' })
		expect(parsed.requestId).toBe('req_abc12345')
	})

	it('should include scope when present', () => {
		const entry: LogEntry = { ...baseEntry, scope: 'Auth' }
		const formatted = formatAsJson(entry)
		const parsed = JSON.parse(formatted)

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
		const formatted = formatAsJson(entry)
		const parsed = JSON.parse(formatted)

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
		const formatted = formatAsJson(entry)
		const parsed = JSON.parse(formatted)

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
		const formatted = formatAsJson(entry)

		expect(() => JSON.parse(formatted)).not.toThrow()
		const parsed = JSON.parse(formatted)
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
		const formatted = formatAsJsonPretty(baseEntry)

		expect(formatted).toContain('\n')
		expect(formatted).toContain('  ') // Indentation
	})

	it('should be parseable as JSON', () => {
		const formatted = formatAsJsonPretty(baseEntry)

		expect(() => JSON.parse(formatted)).not.toThrow()
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
			const formatted = formatAsJson(entry)
			const parsed = JSON.parse(formatted)

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
			const formatted = formatAsJson(entry)
			const parsed = JSON.parse(formatted)

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
			const formatted = formatAsJson(entry)
			const parsed = JSON.parse(formatted)

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
			const formatted = formatAsJson(entry)
			const parsed = JSON.parse(formatted)

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
			const formatted = formatAsJsonPretty(entry)
			const parsed = JSON.parse(formatted)

			expect(parsed.normalKey).toBe('value')
			expect(Object.keys(parsed)).not.toContain('__proto__')
			expect(Object.keys(parsed)).not.toContain('constructor')
		})
	})
})
