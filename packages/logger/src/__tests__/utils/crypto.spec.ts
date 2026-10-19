/**
 * Tests for NextNode Logger request id generation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateRequestId } from '@/utils/crypto.js'

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
		const randomUUID = vi
			.fn()
			.mockReturnValue('12345678-abcd-efgh-ijkl-mnopqrstuvwx')
		vi.stubGlobal('crypto', { randomUUID })

		const requestId = generateRequestId()
		expect(requestId).toBe('req_12345678')
		expect(randomUUID).toHaveBeenCalledOnce()
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
