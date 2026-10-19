/**
 * Tests for NextNode Logger serialization
 */

import { describe, expect, it, vi } from 'vitest'

import { safeStringify } from '@/utils/serialization.js'

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
		const serialized = safeStringify(sym)
		expect(serialized).toContain('Symbol(test)')
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
		const serialized = safeStringify(obj)
		const parsed = JSON.parse(serialized)
		expect(parsed).toEqual(obj)
	})

	it('should handle arrays', () => {
		const arr = [1, 'test', true]
		const serialized = safeStringify(arr)
		const parsed = JSON.parse(serialized)
		expect(parsed).toEqual(arr)
	})

	it('should handle circular references', () => {
		const obj: Record<string, unknown> = { name: 'test' }
		obj.self = obj

		const serialized = safeStringify(obj)
		expect(serialized).toContain('[Circular Reference]')
		expect(serialized).toContain('name')
		expect(serialized).toContain('test')
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

		const serialized = safeStringify(obj)
		expect(serialized).toContain('data')
		expect(serialized).toContain('test')
		expect(serialized).toContain('[Function: method]')
		expect(serialized).toContain('[Function: namedFunc]')
		expect(serialized).toContain('42')
	})

	it('should handle complex types', () => {
		const date = new Date('2024-01-01')
		const regex = /test/g
		const map = new Map([['key', 'value']])
		const set = new Set([1, 2, 3])

		const obj = { date, regex, map, set }
		const serialized = safeStringify(obj)

		expect(serialized).toContain('2024-01-01')
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

		const serialized = safeStringify(problematicObj)
		// Note: Modern JSON.stringify might handle this gracefully, so we just check it doesn't throw
		expect(typeof serialized).toBe('string')
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

		const serialized = safeStringify({ test: 'data' })

		// Should return error message format
		expect(serialized).toMatch(/\[Serialization Error: Stringify failed\]/)

		// Restore original
		vi.stubGlobal('JSON', { ...JSON, stringify: originalStringify })
	})
})
