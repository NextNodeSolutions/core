import { describe, expect, it, vi } from 'vitest'

import {
	POSTGRES_PASSWORD_SECRET,
	ensureEmbeddedPostgresPasswordSecret,
} from './ensure-password.ts'

import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'

const SCOPE = {
	owner: 'nextnode',
	repo: 'acme',
	environment: 'production',
} as const

function fakeAdapter(
	overrides: Partial<EnvSecretsAdapter> = {},
): EnvSecretsAdapter {
	return {
		ghAvailable: () => Promise.resolve(true),
		setRepoEnvSecret: () => Promise.resolve(),
		...overrides,
	}
}

describe('ensureEmbeddedPostgresPasswordSecret', () => {
	it('leaves an existing password untouched (idempotent, non-rotating)', async () => {
		const setRepoEnvSecret = vi.fn(() => Promise.resolve())
		const ghAvailable = vi.fn(() => Promise.resolve(true))

		await ensureEmbeddedPostgresPasswordSecret(
			{ [POSTGRES_PASSWORD_SECRET]: 'already-set' },
			SCOPE,
			fakeAdapter({ setRepoEnvSecret, ghAvailable }),
		)

		expect(setRepoEnvSecret).not.toHaveBeenCalled()
		// no gh probe either - the skip happens before any IO
		expect(ghAvailable).not.toHaveBeenCalled()
	})

	it('generates an ALPHANUMERIC password and pushes it when absent', async () => {
		const setRepoEnvSecret = vi.fn<EnvSecretsAdapter['setRepoEnvSecret']>(
			() => Promise.resolve(),
		)

		await ensureEmbeddedPostgresPasswordSecret(
			{},
			SCOPE,
			fakeAdapter({ setRepoEnvSecret }),
		)

		expect(setRepoEnvSecret).toHaveBeenCalledOnce()
		const [name, value, scope] = setRepoEnvSecret.mock.calls[0] ?? []
		expect(name).toBe(POSTGRES_PASSWORD_SECRET)
		expect(scope).toEqual(SCOPE)
		// The whole point of #2: the value carries no character that would break
		// the raw SQL literal (`'`) or the DATABASE_URL (`@ : / + =`). A base64
		// generator would fail this assertion.
		expect(value).toMatch(/^[A-Za-z0-9]{32}$/)
	})

	it('fails loud when gh is unavailable but a push is needed', async () => {
		await expect(
			ensureEmbeddedPostgresPasswordSecret(
				{},
				SCOPE,
				fakeAdapter({ ghAvailable: () => Promise.resolve(false) }),
			),
		).rejects.toThrow('gh CLI unavailable')
	})
})
