import { describe, expect, it } from 'vitest'

import { ensureGeneratedSecrets } from './ensure-generated-secrets.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

interface VaultWrite {
	readonly path: string
	readonly secrets: Readonly<Record<string, string>>
}

const SCOPE = { repo: 'fleurs', environment: 'production' } as const

// In-memory fake of the vault boundary (preferred over a mock): records every
// write so behavior - not call mechanics - can be asserted.
function fakeVault(): { vault: SecretVault; writes: VaultWrite[] } {
	const writes: VaultWrite[] = []
	const vault: SecretVault = {
		listSecrets: () => Promise.resolve({}),
		setSecrets: (path, secrets) => {
			writes.push({ path, secrets })
			return Promise.resolve()
		},
	}
	return { vault, writes }
}

describe('ensureGeneratedSecrets', () => {
	it('generates a secret absent from ALL_SECRETS and stores it in the project folder', async () => {
		const { vault, writes } = fakeVault()

		await ensureGeneratedSecrets(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{},
			SCOPE,
			vault,
		)

		expect(writes).toHaveLength(1)
		const [write] = writes
		expect(write?.path).toBe('/projects/fleurs/production')
		expect(Object.keys(write?.secrets ?? {})).toStrictEqual(['JWT_SECRET'])
		expect(write?.secrets['JWT_SECRET']).toHaveLength(32)
		expect(write?.secrets['JWT_SECRET']).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('skips a secret already present in ALL_SECRETS (no rotation)', async () => {
		const { vault, writes } = fakeVault()

		await ensureGeneratedSecrets(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{ JWT_SECRET: 'already-there' },
			SCOPE,
			vault,
		)

		expect(writes).toHaveLength(0)
	})

	it('regenerates a secret whose ALL_SECRETS value is an empty string', async () => {
		const { vault, writes } = fakeVault()

		await ensureGeneratedSecrets(
			[{ name: 'DB_PASSWORD', generate: 'password', length: 24 }],
			{ DB_PASSWORD: '' },
			SCOPE,
			vault,
		)

		expect(writes).toHaveLength(1)
		expect(writes[0]?.secrets['DB_PASSWORD']).toMatch(/^[A-Za-z0-9]{24}$/)
	})

	it('does not touch the vault when there is nothing to generate', async () => {
		const { vault, writes } = fakeVault()

		await ensureGeneratedSecrets([], {}, SCOPE, vault)

		expect(writes).toHaveLength(0)
	})
})
