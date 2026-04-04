/**
 * Security tests for HTTP transport
 * Tests URL validation, header sanitization, and SSRF prevention
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHttpTransport, HttpTransport } from '@/transports/http.js'

describe('HttpTransport Security', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('URL Validation', () => {
		it('should accept valid HTTP URLs', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'http://example.com/logs',
					}),
			).not.toThrow()
		})

		it('should accept valid HTTPS URLs', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
					}),
			).not.toThrow()
		})

		it('should accept localhost URLs', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'http://localhost:3000/logs',
					}),
			).not.toThrow()
		})

		it('should reject javascript: protocol (XSS prevention)', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'javascript:alert(1)',
					}),
			).toThrow('Invalid protocol')
		})

		it('should reject file: protocol (local file access)', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'file:///etc/passwd',
					}),
			).toThrow('Invalid protocol')
		})

		it('should reject data: protocol', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'data:text/html,<script>alert(1)</script>',
					}),
			).toThrow('Invalid protocol')
		})

		it('should reject ftp: protocol', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'ftp://example.com/logs',
					}),
			).toThrow('Invalid protocol')
		})

		it('should reject invalid URLs', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'not-a-valid-url',
					}),
			).toThrow('Invalid endpoint URL')
		})

		it('should reject empty endpoint', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: '',
					}),
			).toThrow('Invalid endpoint URL')
		})

		it('should reject URLs with only protocol', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'http://',
					}),
			).toThrow('Invalid endpoint URL')
		})
	})

	describe('Header Sanitization', () => {
		it('should accept custom authorization headers', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							Authorization: 'Bearer token123',
						},
					}),
			).not.toThrow()
		})

		it('should accept custom x-api-key headers', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							'X-API-Key': 'secret-key',
						},
					}),
			).not.toThrow()
		})

		it('should reject Host header override', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							Host: 'attacker.com',
						},
					}),
			).toThrow('Header "Host" is restricted')
		})

		it('should reject host header override (lowercase)', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							host: 'attacker.com',
						},
					}),
			).toThrow('Header "host" is restricted')
		})

		it('should reject Content-Length header override', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							'Content-Length': '999999',
						},
					}),
			).toThrow('Header "Content-Length" is restricted')
		})

		it('should reject Transfer-Encoding header override', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							'Transfer-Encoding': 'chunked',
						},
					}),
			).toThrow('Header "Transfer-Encoding" is restricted')
		})

		it('should allow multiple safe headers', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
						headers: {
							Authorization: 'Bearer token',
							'X-Request-ID': '12345',
							'X-Custom-Header': 'value',
						},
					}),
			).not.toThrow()
		})

		it('should handle missing headers gracefully', () => {
			expect(
				() =>
					new HttpTransport({
						endpoint: 'https://example.com/logs',
					}),
			).not.toThrow()
		})
	})

	describe('createHttpTransport factory', () => {
		it('should apply same validation as constructor', () => {
			expect(() =>
				createHttpTransport({
					endpoint: 'javascript:alert(1)',
				}),
			).toThrow('Invalid protocol')
		})

		it('should validate headers through factory', () => {
			expect(() =>
				createHttpTransport({
					endpoint: 'https://example.com/logs',
					headers: { Host: 'evil.com' },
				}),
			).toThrow('Header "Host" is restricted')
		})
	})
})
