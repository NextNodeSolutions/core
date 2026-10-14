import { describe, expect, it, vi } from 'vitest'

import {
	POSTGRES_PASSWORD_SECRET,
	ensureEmbeddedPostgresPasswordSecret,
} from './ensure-password.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const SCOPE = { repo: 'acme', environment: 'production' } as const

function fakeVault(overrides: Partial<SecretVault> = {}): SecretVault {
	return {
		listSecrets: () => Promise.resolve({}),
		setSecrets: () => Promise.resolve(),
		...overrides,
	}
}

describe('ensureEmbeddedPostgresPasswordSecret', () => {
	it('leaves an existing password untouched (idempotent, non-rotating)', async () => {
		const setSecrets = vi.fn(() => Promise.resolve())

		await ensureEmbeddedPostgresPasswordSecret(
			{ [POSTGRES_PASSWORD_SECRET]: 'already-set' },
			SCOPE,
			fakeVault({ setSecrets }),
		)

		expect(setSecrets).not.toHaveBeenCalled()
	})

	it('generates an ALPHANUMERIC password and stores it when absent', async () => {
		const setSecrets = vi.fn<SecretVault['setSecrets']>(() =>
			Promise.resolve(),
		)

		await ensureEmbeddedPostgresPasswordSecret(
			{},
			SCOPE,
			fakeVault({ setSecrets }),
		)

		expect(setSecrets).toHaveBeenCalledOnce()
		const [path, secrets] = setSecrets.mock.calls[0] ?? []
		expect(path).toBe('/projects/acme/production')
		// The whole point of #2: the value carries no character that would break
		// the raw SQL literal (`'`) or the DATABASE_URL (`@ : / + =`). A base64
		// generator would fail this assertion.
		expect(secrets?.[POSTGRES_PASSWORD_SECRET]).toMatch(/^[A-Za-z0-9]{32}$/)
	})
})
