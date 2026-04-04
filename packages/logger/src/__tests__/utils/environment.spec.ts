/**
 * Tests for NextNode Logger environment detection
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { detectRuntime, hasCryptoSupport } from '@/utils/environment.js'

describe('Environment Detection', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.unstubAllGlobals()
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe('detectRuntime', () => {
		it('should detect Node.js environment', () => {
			// Default test environment should be Node.js
			const runtime = detectRuntime()
			expect(runtime).toBe('node')
		})

		it('should detect browser environment', () => {
			// Mock browser environment
			vi.stubGlobal('process', undefined)
			vi.stubGlobal('window', {})
			vi.stubGlobal('document', {})

			const runtime = detectRuntime()
			expect(runtime).toBe('browser')
		})

		it('should detect webworker environment', () => {
			// Mock webworker environment
			vi.stubGlobal('process', undefined)
			vi.stubGlobal('window', undefined)
			vi.stubGlobal('document', undefined)

			// Mock importScripts global
			vi.stubGlobal('importScripts', vi.fn())

			const runtime = detectRuntime()
			expect(runtime).toBe('webworker')
		})

		it('should detect unknown environment when no indicators are present', () => {
			// Remove all environment indicators using vi.stubGlobal
			vi.stubGlobal('process', undefined)
			vi.stubGlobal('window', undefined)
			vi.stubGlobal('document', undefined)
			vi.stubGlobal('importScripts', undefined)

			const runtime = detectRuntime()
			expect(runtime).toBe('unknown')
		})

		it('should prioritize Node.js detection over other environments', () => {
			// Mock both Node.js and browser indicators
			vi.stubGlobal('process', { versions: { node: '20.0.0' } })
			vi.stubGlobal('window', {})
			vi.stubGlobal('document', {})

			const runtime = detectRuntime()
			expect(runtime).toBe('node')
		})
	})

	describe('hasCryptoSupport', () => {
		it('should detect crypto support when crypto.randomUUID exists', () => {
			// Default Node.js environment should have crypto support
			const hasSupport = hasCryptoSupport()
			expect(hasSupport).toBe(true)
		})

		it('should detect lack of crypto support when crypto is undefined', () => {
			// Mock environment without crypto
			vi.stubGlobal('crypto', undefined)

			const hasSupport = hasCryptoSupport()
			expect(hasSupport).toBe(false)
		})

		it('should detect lack of crypto support when randomUUID is not available', () => {
			// Mock crypto without randomUUID
			vi.stubGlobal('crypto', {
				subtle: {},
				// randomUUID missing
			})

			const hasSupport = hasCryptoSupport()
			expect(hasSupport).toBe(false)
		})

		it('should detect crypto support in browser environment', () => {
			// Mock browser crypto
			vi.stubGlobal('crypto', {
				randomUUID: vi.fn().mockReturnValue('test-uuid'),
			})

			const hasSupport = hasCryptoSupport()
			expect(hasSupport).toBe(true)
		})

		it('should handle crypto as non-object gracefully', () => {
			// Mock crypto as primitive
			vi.stubGlobal('crypto', 'not-an-object')

			const hasSupport = hasCryptoSupport()
			expect(hasSupport).toBe(false)
		})
	})

	describe('Environment integration scenarios', () => {
		it('should work correctly in Node.js with crypto support', () => {
			// Ensure clean Node.js environment
			vi.stubGlobal('process', { versions: { node: '20.0.0' } })
			vi.stubGlobal('window', undefined)
			vi.stubGlobal('document', undefined)

			const runtime = detectRuntime()
			const hasSupport = hasCryptoSupport()

			expect(runtime).toBe('node')
			expect(hasSupport).toBe(true)
		})

		it('should work correctly in browser with crypto support', () => {
			// Mock modern browser environment
			vi.stubGlobal('process', undefined)
			vi.stubGlobal('importScripts', undefined) // Ensure webworker detection is disabled
			vi.stubGlobal('window', {})
			vi.stubGlobal('document', {})
			vi.stubGlobal('crypto', {
				randomUUID: vi.fn().mockReturnValue('browser-uuid'),
			})

			const runtime = detectRuntime()
			const hasSupport = hasCryptoSupport()

			expect(runtime).toBe('browser')
			expect(hasSupport).toBe(true)
		})

		it('should handle legacy browser without crypto gracefully', () => {
			// Mock old browser environment
			vi.stubGlobal('process', undefined)
			vi.stubGlobal('importScripts', undefined) // Ensure webworker detection is disabled
			vi.stubGlobal('window', {})
			vi.stubGlobal('document', {})
			vi.stubGlobal('crypto', undefined)

			const runtime = detectRuntime()
			const hasSupport = hasCryptoSupport()

			expect(runtime).toBe('browser')
			expect(hasSupport).toBe(false)
		})
	})
})
