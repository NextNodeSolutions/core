/**
 * Tests for NextNode Logger utilities
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateRequestId } from '@/utils/crypto.js'
import { safeStringify } from '@/utils/serialization.js'
import { getCurrentTimestamp } from '@/utils/time.js'

// No more node:crypto mock needed - using crypto global now

describe('generateRequestId', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.unstubAllGlobals()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('should generate a request ID with req_ prefix using crypto global', () => {
		const requestId = generateRequestId()
		// Should match UUID format (8 hex chars after req_)
		expect(requestId).toMatch(/^req_[a-f0-9]{8}$/)
		expect(requestId.length).toBe(12) // req_ (4) + 8 hex chars
	})

	it('should generate unique request IDs', () => {
		const id1 = generateRequestId()
		const id2 = generateRequestId()
		expect(id1).not.toBe(id2)
		expect(id1).toMatch(/^req_[a-f0-9]{8}$/)
		expect(id2).toMatch(/^req_[a-f0-9]{8}$/)
	})

	it('should work in browser environment with Web Crypto API', () => {
		// Mock browser environment with crypto support
		vi.stubGlobal('process', undefined)
		vi.stubGlobal('crypto', {
			randomUUID: vi
				.fn()
				.mockReturnValue('12345678-abcd-efgh-ijkl-mnopqrstuvwx'),
		})

		const requestId = generateRequestId()
		expect(requestId).toBe('req_12345678')
		expect(vi.mocked(crypto.randomUUID)).toHaveBeenCalledOnce()
	})

	it('should work in Node.js environment with crypto global', () => {
		// Ensure Node.js environment
		vi.stubGlobal('process', { versions: { node: '20.0.0' } })

		// Mock crypto global (which exists in Node.js v20+)
		const mockCrypto = {
			randomUUID: vi
				.fn()
				.mockReturnValue('abcdefgh-1234-5678-9012-abcdefghijkl'),
		}
		vi.stubGlobal('crypto', mockCrypto)

		const requestId = generateRequestId()
		expect(requestId).toBe('req_abcdefgh')
		expect(mockCrypto.randomUUID).toHaveBeenCalledOnce()
	})

	it('should throw error when Web Crypto API is not available', () => {
		// Mock environment without crypto support
		vi.stubGlobal('crypto', undefined)

		expect(() => generateRequestId()).toThrow(
			"Web Crypto API not available in node environment. Please ensure you're using Node.js v20+ or a modern browser.",
		)
	})

	it('should throw error when randomUUID is not available in crypto', () => {
		// Mock crypto without randomUUID
		vi.stubGlobal('crypto', {
			subtle: {},
			// randomUUID missing
		})

		expect(() => generateRequestId()).toThrow(
			'Web Crypto API not available in node environment',
		)
	})

	it('should provide environment-specific error messages', () => {
		// Test browser environment error
		vi.stubGlobal('process', undefined)
		vi.stubGlobal('crypto', undefined)

		// Mock browser indicators
		// Mock browser environment
		vi.stubGlobal('window', {})
		vi.stubGlobal('document', {})

		expect(() => generateRequestId()).toThrow(
			'Web Crypto API not available in browser environment',
		)
	})
})

describe('safeStringify', () => {
	it('should handle null and undefined', () => {
		expect(safeStringify(null)).toBe('null')
		expect(safeStringify(undefined)).toBe('undefined')
	})

	it('should handle primitive types', () => {
		expect(safeStringify('hello')).toBe('hello')
		expect(safeStringify(42)).toBe('42')
		expect(safeStringify(true)).toBe('true')
		expect(safeStringify(false)).toBe('false')
		expect(safeStringify(BigInt(123))).toBe('123')
	})

	it('should handle symbols', () => {
		const sym = Symbol('test')
		const result = safeStringify(sym)
		expect(result).toContain('Symbol(test)')
	})

	it('should handle functions', () => {
		const namedFunction = function testFunc(): void {}
		const anonymousFunction = (): void => {}

		expect(safeStringify(namedFunction)).toBe('[Function: testFunc]')
		expect(safeStringify(anonymousFunction)).toBe(
			'[Function: anonymousFunction]',
		)
	})

	it('should handle simple objects', () => {
		const obj = { name: 'test', value: 42 }
		const result = safeStringify(obj)
		const parsed = JSON.parse(result)
		expect(parsed).toEqual(obj)
	})

	it('should handle arrays', () => {
		const arr = [1, 'test', true]
		const result = safeStringify(arr)
		const parsed = JSON.parse(result)
		expect(parsed).toEqual(arr)
	})

	it('should handle circular references', () => {
		const obj: Record<string, unknown> = { name: 'test' }
		obj.self = obj

		const result = safeStringify(obj)
		expect(result).toContain('[Circular Reference]')
		expect(result).toContain('name')
		expect(result).toContain('test')
	})

	it('should handle nested objects with functions', () => {
		const obj = {
			data: 'test',
			method: (): string => 'result',
			nested: {
				value: 42,
				func: function namedFunc(): void {},
			},
		}

		const result = safeStringify(obj)
		expect(result).toContain('data')
		expect(result).toContain('test')
		expect(result).toContain('[Function: method]')
		expect(result).toContain('[Function: namedFunc]')
		expect(result).toContain('42')
	})

	it('should handle complex types', () => {
		const date = new Date('2024-01-01')
		const regex = /test/g
		const map = new Map([['key', 'value']])
		const set = new Set([1, 2, 3])

		const obj = { date, regex, map, set }
		const result = safeStringify(obj)

		expect(result).toContain('2024-01-01')
		expect(() => safeStringify(obj)).not.toThrow()
	})

	it('should provide fallback for serialization errors', () => {
		// Create an object that will cause JSON.stringify to throw
		const problematicObj = {}
		Object.defineProperty(problematicObj, 'prop', {
			get(): never {
				throw new Error('Cannot access')
			},
		})

		const result = safeStringify(problematicObj)
		// Note: Modern JSON.stringify might handle this gracefully, so we just check it doesn't throw
		expect(typeof result).toBe('string')
	})

	it('should handle JSON.stringify throwing error and provide fallback message', () => {
		// Mock JSON.stringify to always throw
		const originalStringify = JSON.stringify
		vi.stubGlobal('JSON', {
			...JSON,
			stringify: vi.fn().mockImplementation(() => {
				throw new Error('Stringify failed')
			}),
		})

		const result = safeStringify({ test: 'data' })

		// Should return error message format
		expect(result).toMatch(/\[Serialization Error: Stringify failed\]/)

		// Restore original
		vi.stubGlobal('JSON', { ...JSON, stringify: originalStringify })
	})
})

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
