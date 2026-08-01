import {
	APP_WITH_SECRETS,
	STATIC_WITH_DOMAIN,
	STATIC_WITH_MISSING_SECRET,
	STATIC_WITH_SECRETS,
} from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkSecretsCommand } from './check-secrets.command.ts'

beforeEach(() => {
	vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('checkSecretsCommand', () => {
	it('passes when every declared secret is in ALL_SECRETS', () => {
		vi.stubEnv('ALL_SECRETS', JSON.stringify({ RESEND_API_KEY: 'value' }))

		checkSecretsCommand(STATIC_WITH_SECRETS)
	})

	it('throws naming the missing secret and its environment', () => {
		vi.stubEnv('ALL_SECRETS', JSON.stringify({ OTHER: 'value' }))

		expect(() => checkSecretsCommand(STATIC_WITH_MISSING_SECRET)).toThrow(
			/MISSING_KEY/,
		)
		expect(() => checkSecretsCommand(STATIC_WITH_MISSING_SECRET)).toThrow(
			/production/,
		)
	})

	it('covers the per-service secret pool of a hetzner deploy', () => {
		vi.stubEnv('ALL_SECRETS', JSON.stringify({}))

		expect(() => checkSecretsCommand(APP_WITH_SECRETS)).toThrow(
			/DATABASE_URL/,
		)
	})

	it('passes when the config declares no secret', () => {
		vi.stubEnv('ALL_SECRETS', JSON.stringify({}))

		checkSecretsCommand(STATIC_WITH_DOMAIN)
	})
})
