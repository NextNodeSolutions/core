import { describe, expect, it } from 'vitest'

import { formatComposeEnv } from './compose-env.ts'

describe('formatComposeEnv', () => {
	it('serializes a record into KEY=value lines', () => {
		const result = formatComposeEnv({
			SITE_URL: 'https://acme.example.com',
			COMPOSE_PROJECT_NAME: 'acme-web-prod',
		})
		expect(result).toBe(
			'SITE_URL=https://acme.example.com\nCOMPOSE_PROJECT_NAME=acme-web-prod',
		)
	})

	it('preserves insertion order of keys', () => {
		const result = formatComposeEnv({
			B_VAR: '2',
			A_VAR: '1',
			C_VAR: '3',
		})
		expect(result.split('\n')).toStrictEqual([
			'B_VAR=2',
			'A_VAR=1',
			'C_VAR=3',
		])
	})

	it('does not escape or quote values with special characters', () => {
		const result = formatComposeEnv({
			DB_URL: 'postgres://user:p@ss=word@host/db?ssl=true',
		})
		expect(result).toBe('DB_URL=postgres://user:p@ss=word@host/db?ssl=true')
	})

	it('returns an empty string when the record is empty', () => {
		expect(formatComposeEnv({})).toBe('')
	})
})
