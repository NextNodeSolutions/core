import { describe, expect, it } from 'vitest'

import { ensureGeneratedSecrets } from './ensure-generated-secrets.ts'

import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'

interface PushCall {
	readonly name: string
	readonly value: string
	readonly owner: string
	readonly repo: string
	readonly environment: string
}

// In-memory fake of the gh env-secret boundary (preferred over a mock): records
// every push so behavior — not call mechanics — can be asserted.
function fakeAdapter(ghAvailable = true): {
	adapter: EnvSecretsAdapter
	pushes: PushCall[]
} {
	const pushes: PushCall[] = []
	const adapter: EnvSecretsAdapter = {
		ghAvailable: () => Promise.resolve(ghAvailable),
		setRepoEnvSecret: (name, value, owner, repo, environment) => {
			pushes.push({ name, value, owner, repo, environment })
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
			'nextnode',
			'fleurs',
			'production',
			adapter,
		)

		expect(pushes).toHaveLength(1)
		const [push] = pushes
		expect(push?.name).toBe('JWT_SECRET')
		expect(push?.owner).toBe('nextnode')
		expect(push?.repo).toBe('fleurs')
		expect(push?.environment).toBe('production')
		expect(push?.value).toHaveLength(32)
		expect(push?.value).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('skips a secret already present in ALL_SECRETS (no rotation)', async () => {
		const { adapter, pushes } = fakeAdapter()

		await ensureGeneratedSecrets(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{ JWT_SECRET: 'already-there' },
			'nextnode',
			'fleurs',
			'production',
			adapter,
		)

		expect(pushes).toHaveLength(0)
	})

	it('regenerates a secret whose ALL_SECRETS value is an empty string', async () => {
		const { adapter, pushes } = fakeAdapter()

		await ensureGeneratedSecrets(
			[{ name: 'DB_PASSWORD', generate: 'password', length: 24 }],
			{ DB_PASSWORD: '' },
			'nextnode',
			'fleurs',
			'production',
			adapter,
		)

		expect(pushes).toHaveLength(1)
		expect(pushes[0]?.value).toMatch(/^[A-Za-z0-9]{24}$/)
	})

	it('fails loud when gh is unavailable and a secret must be generated', async () => {
		const { adapter, pushes } = fakeAdapter(false)

		await expect(
			ensureGeneratedSecrets(
				[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
				{},
				'nextnode',
				'fleurs',
				'production',
				adapter,
			),
		).rejects.toThrow(/gh CLI unavailable/)
		expect(pushes).toHaveLength(0)
	})

	it('does not probe gh when there is nothing to generate', async () => {
		let probed = false
		const adapter: EnvSecretsAdapter = {
			ghAvailable: () => {
				probed = true
				return Promise.resolve(true)
			},
			setRepoEnvSecret: () => Promise.resolve(),
		}

		await ensureGeneratedSecrets(
			[],
			{},
			'nextnode',
			'fleurs',
			'production',
			adapter,
		)

		expect(probed).toBe(false)
	})
})
