import { describe, expect, it } from 'vitest'

import { computeSilo } from './env-silo.ts'

describe('computeSilo', () => {
	it('builds id from project and env', () => {
		expect(computeSilo('acme-web', 'dev')).toStrictEqual({
			id: 'acme-web-dev',
		})
	})

	it('produces different ids for different envs', () => {
		const dev = computeSilo('acme-web', 'dev')
		const prod = computeSilo('acme-web', 'prod')
		expect(dev.id).not.toBe(prod.id)
	})

	it('produces different ids for different projects', () => {
		const a = computeSilo('acme-web', 'dev')
		const b = computeSilo('other-app', 'dev')
		expect(a.id).not.toBe(b.id)
	})
})
