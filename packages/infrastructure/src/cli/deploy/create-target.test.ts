import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HetznerDeployableConfig } from '../../config/types.ts'

import { createTarget } from './create-target.ts'

vi.mock('./ensure-r2.ts', () => ({
	ensureR2Setup: vi.fn(async () => ({
		accountId: 'acct',
		endpoint: 'https://r2.example.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	})),
}))

vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(),
}))

const HETZNER_CONFIG: HetznerDeployableConfig = {
	project: {
		name: 'acme-web',
		type: 'app',
		filter: false,
		domain: 'acme-web.example.com',
		redirectDomains: [],
	},
	scripts: { lint: false, test: false, build: false },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'hetzner-vps',
		secrets: [],
		hetzner: { serverType: 'cpx22', location: 'nbg1' },
	},
}

function stubHetznerEnv(): void {
	vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf')
	vi.stubEnv('HETZNER_API_TOKEN', 'hcloud')
	vi.stubEnv(
		'DEPLOY_SSH_PRIVATE_KEY_B64',
		Buffer.from('priv').toString('base64'),
	)
	vi.stubEnv('DEPLOY_SSH_PUBLIC_KEY', 'pub')
	vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey')
}

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('createTarget — Hetzner env wiring', () => {
	it('wires credentials from env into the target config', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('../../adapters/hetzner/target.ts')

		await createTarget(HETZNER_CONFIG, 'production')

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				credentials: {
					hcloudToken: 'hcloud',
					deployPrivateKey: 'priv',
					deployPublicKey: 'pub',
					tailscaleAuthKey: 'tskey',
				},
			}),
		)
	})

	it('omits the vector block when NN_VL_URL is unset', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('../../adapters/hetzner/target.ts')

		await createTarget(HETZNER_CONFIG, 'production')

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({ vector: null }),
		)
	})

	it('builds the vector block when NN_VL_URL is set', async () => {
		stubHetznerEnv()
		vi.stubEnv('NN_VL_URL', 'http://vl:9428')
		vi.stubEnv('NN_CLIENT_ID', 'nextnode')

		const { HetznerVpsTarget } =
			await import('../../adapters/hetzner/target.ts')

		await createTarget(HETZNER_CONFIG, 'production')

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				vector: { clientId: 'nextnode', vlUrl: 'http://vl:9428' },
			}),
		)
	})

	it('throws when HETZNER_API_TOKEN is missing', async () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf')

		await expect(
			createTarget(HETZNER_CONFIG, 'production'),
		).rejects.toThrow('HETZNER_API_TOKEN env var is required')
	})

	it('throws when DEPLOY_SSH_PRIVATE_KEY_B64 is missing', async () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud')

		await expect(
			createTarget(HETZNER_CONFIG, 'production'),
		).rejects.toThrow('DEPLOY_SSH_PRIVATE_KEY_B64 env var is required')
	})

	it('throws when NN_CLIENT_ID is missing but NN_VL_URL is set', async () => {
		stubHetznerEnv()
		vi.stubEnv('NN_VL_URL', 'http://vl:9428')

		await expect(
			createTarget(HETZNER_CONFIG, 'production'),
		).rejects.toThrow('NN_CLIENT_ID env var is required')
	})
})
