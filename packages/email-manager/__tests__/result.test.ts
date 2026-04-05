/**
 * Result factory function tests
 * Covers the runtime behavior of fail(), emailError(), emailFail()
 */
import { describe, expect, it } from 'vitest'

import { emailError, emailFail, fail } from '../src/types/result.js'

describe('fail()', () => {
	it('wraps an error value into a failure result', () => {
		const err = new Error('boom')
		const result = fail(err)

		expect(result).toEqual({ success: false, error: err })
	})

	it('preserves the error identity', () => {
		const err = new Error('boom')
		const result = fail(err)

		expect(result.error).toBe(err)
	})
})

describe('emailError()', () => {
	it('builds an EmailError with code and message', () => {
		const err = emailError('VALIDATION_ERROR', 'bad input')

		expect(err).toEqual({
			code: 'VALIDATION_ERROR',
			message: 'bad input',
		})
	})

	it('merges optional provider and originalError fields', () => {
		const original = new Error('upstream')
		const err = emailError('PROVIDER_ERROR', 'api fail', {
			provider: 'resend',
			originalError: original,
		})

		expect(err).toEqual({
			code: 'PROVIDER_ERROR',
			message: 'api fail',
			provider: 'resend',
			originalError: original,
		})
	})

	it('omits optional fields when not provided', () => {
		const err = emailError('UNKNOWN_ERROR', 'mystery')

		expect(err).not.toHaveProperty('provider')
		expect(err).not.toHaveProperty('originalError')
	})
})

describe('emailFail()', () => {
	it('wraps an EmailError into a failure result', () => {
		const result = emailFail('AUTHENTICATION_ERROR', 'bad key')

		expect(result).toEqual({
			success: false,
			error: {
				code: 'AUTHENTICATION_ERROR',
				message: 'bad key',
			},
		})
	})

	it('forwards optional fields to the underlying EmailError', () => {
		const result = emailFail('RATE_LIMIT_ERROR', 'slow down', {
			provider: 'resend',
		})

		expect(result.error).toMatchObject({
			code: 'RATE_LIMIT_ERROR',
			message: 'slow down',
			provider: 'resend',
		})
	})
})
