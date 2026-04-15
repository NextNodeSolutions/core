import { describe, expect, it } from 'vitest'

import { resolveComposeEnv } from './resolve-compose-env.ts'

const baseInput = {
	hostname: 'acme.example.com',
	composeProjectName: 'acme-web-prod',
	envName: 'prod',
	secrets: {},
} as const

describe('resolveComposeEnv', () => {
	it('generates SITE_URL from hostname', () => {
		const result = resolveComposeEnv(baseInput)
		expect(result).toContain('SITE_URL=https://acme.example.com')
	})

	it('generates COMPOSE_PROJECT_NAME', () => {
		const result = resolveComposeEnv(baseInput)
		expect(result).toContain('COMPOSE_PROJECT_NAME=acme-web-prod')
	})

	it('generates NN_ENVIRONMENT', () => {
		const result = resolveComposeEnv(baseInput)
		expect(result).toContain('NN_ENVIRONMENT=prod')
	})

	it('merges CI secrets into the output', () => {
		const result = resolveComposeEnv({
			...baseInput,
			secrets: { DATABASE_URL: 'postgres://localhost/db' },
		})
		expect(result).toContain('DATABASE_URL=postgres://localhost/db')
	})

	it('allows CI secrets to override auto-generated vars', () => {
		const result = resolveComposeEnv({
			...baseInput,
			secrets: { SITE_URL: 'https://custom.example.com' },
		})
		const siteUrlLines = result
			.split('\n')
			.filter(line => line.startsWith('SITE_URL='))
		expect(siteUrlLines).toStrictEqual([
			'SITE_URL=https://custom.example.com',
		])
	})

	it('produces valid KEY=value format on every line', () => {
		const result = resolveComposeEnv({
			...baseInput,
			secrets: { SECRET_KEY: 'abc123' },
		})
		for (const line of result.split('\n')) {
			expect(line).toMatch(/^[A-Z_]+=.+$/)
		}
	})

	it('handles values with special characters', () => {
		const result = resolveComposeEnv({
			...baseInput,
			secrets: { DB_URL: 'postgres://user:p@ss=word@host/db?ssl=true' },
		})
		expect(result).toContain(
			'DB_URL=postgres://user:p@ss=word@host/db?ssl=true',
		)
	})
})
