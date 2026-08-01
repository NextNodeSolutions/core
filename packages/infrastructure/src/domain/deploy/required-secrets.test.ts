import { describe, expect, it } from 'vitest'

import {
	collectRequiredSecrets,
	findMissingSecrets,
	formatMissingSecretsError,
} from './required-secrets.ts'

import type { CloudflarePagesDeploySection } from '#/config/types.ts'

function pagesDeploy(
	secrets: ReadonlyArray<string>,
	generatedSecrets: CloudflarePagesDeploySection['generatedSecrets'] = [],
): CloudflarePagesDeploySection {
	return {
		target: 'cloudflare-pages',
		secrets,
		generatedSecrets,
		vps: null,
		volumes: [],
	}
}

describe('collectRequiredSecrets', () => {
	it('returns every declared must-exist secret', () => {
		const required = collectRequiredSecrets(
			pagesDeploy(['RESEND_API_KEY', 'STRIPE_SECRET_KEY']),
		)

		expect(required).toStrictEqual(['RESEND_API_KEY', 'STRIPE_SECRET_KEY'])
	})

	it('excludes auto-generated secrets provision has yet to push', () => {
		const required = collectRequiredSecrets(
			pagesDeploy(
				['RESEND_API_KEY', 'JWT_SECRET'],
				[{ name: 'JWT_SECRET', generate: 'token', length: 43 }],
			),
		)

		expect(required).toStrictEqual(['RESEND_API_KEY'])
	})

	it('returns an empty list when nothing is declared', () => {
		expect(collectRequiredSecrets(pagesDeploy([]))).toStrictEqual([])
	})
})

describe('findMissingSecrets', () => {
	it('reports every absent name, not just the first', () => {
		const missing = findMissingSecrets(['A', 'B', 'C'], { B: 'set' })

		expect(missing).toStrictEqual(['A', 'C'])
	})

	it('treats an empty string value as present', () => {
		expect(findMissingSecrets(['A'], { A: '' })).toStrictEqual([])
	})

	it('returns an empty list when every secret is available', () => {
		expect(findMissingSecrets(['A'], { A: 'x', B: 'y' })).toStrictEqual([])
	})
})

describe('formatMissingSecretsError', () => {
	it('names every missing secret and the command that sets it', () => {
		const message = formatMissingSecretsError(
			['RESEND_API_KEY', 'STRIPE_SECRET_KEY'],
			'production',
		)

		expect(message).toContain('RESEND_API_KEY, STRIPE_SECRET_KEY')
		expect(message).toContain(
			'gh secret set RESEND_API_KEY --env production',
		)
		expect(message).toContain(
			'gh secret set STRIPE_SECRET_KEY --env production',
		)
	})
})
