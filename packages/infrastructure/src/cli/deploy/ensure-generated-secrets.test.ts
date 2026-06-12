import { describe, expect, it } from 'vitest'

import { ensureGeneratedSecrets } from './ensure-generated-secrets.ts'

import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'

interface PushCall {
	readonly name: string
	readonly secretValue: string
	readonly owner: string
	readonly repo: string
	readonly environment: string
}

// In-memory fake of the gh env-secret boundary (preferred over a mock): records
// every push so behavior - not call mechanics - can be asserted.
function fakeAdapter(isGhAvailable = true): {
	adapter: EnvSecretsAdapter
	pushes: PushCall[]
} {
	const pushes: PushCall[] = []
	const adapter: EnvSecretsAdapter = {
		ghAvailable: () => Promise.resolve(isGhAvailable),
		setRepoEnvSecret: (name, secretValue, scope) => {
			pushes.push({
				name,
				secretValue,
				owner: scope.owner,
				repo: scope.repo,
				environment: scope.environment,
			})
			return Promise.resolve()
		},
	}
	return { adapter, pushes }
}

describe('ensureGeneratedSecrets', () => {
	it('generates and pushes a secret absent from ALL_SECRETS', async () => {
		const { adapter, pushes } = fakeAdapter()

		await ensureGeneratedSecrets(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{},
			{ owner: 'nextnode', repo: 'fleurs', environment: 'production' },
			adapter,
		)

		expect(pushes).toHaveLength(1)
		const [push] = pushes
		expect(push?.name).toBe('JWT_SECRET')
		expect(push?.owner).toBe('nextnode')
		expect(push?.repo).toBe('fleurs')
		expect(push?.environment).toBe('production')
		expect(push?.secretValue).toHaveLength(32)
		expect(push?.secretValue).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('skips a secret already present in ALL_SECRETS (no rotation)', async () => {
		const { adapter, pushes } = fakeAdapter()

		await ensureGeneratedSecrets(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{ JWT_SECRET: 'already-there' },
			{ owner: 'nextnode', repo: 'fleurs', environment: 'production' },
			adapter,
		)

		expect(pushes).toHaveLength(0)
	})

	it('regenerates a secret whose ALL_SECRETS value is an empty string', async () => {
		const { adapter, pushes } = fakeAdapter()

		await ensureGeneratedSecrets(
			[{ name: 'DB_PASSWORD', generate: 'password', length: 24 }],
			{ DB_PASSWORD: '' },
			{ owner: 'nextnode', repo: 'fleurs', environment: 'production' },
			adapter,
		)

		expect(pushes).toHaveLength(1)
		expect(pushes[0]?.secretValue).toMatch(/^[A-Za-z0-9]{24}$/)
	})

	it('fails loud when gh is unavailable and a secret must be generated', async () => {
		const { adapter, pushes } = fakeAdapter(false)

		await expect(
			ensureGeneratedSecrets(
				[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
				{},
				{
					owner: 'nextnode',
					repo: 'fleurs',
					environment: 'production',
				},
				adapter,
			),
		).rejects.toThrow(/gh CLI unavailable/)
		expect(pushes).toHaveLength(0)
	})

	it('does not probe gh when there is nothing to generate', async () => {
		let wasProbed = false
		const adapter: EnvSecretsAdapter = {
			ghAvailable: () => {
				wasProbed = true
				return Promise.resolve(true)
			},
			setRepoEnvSecret: () => Promise.resolve(),
		}

		await ensureGeneratedSecrets(
			[],
			{},
			{ owner: 'nextnode', repo: 'fleurs', environment: 'production' },
			adapter,
		)

		expect(wasProbed).toBe(false)
	})
})
