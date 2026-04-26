import ssh2 from 'ssh2'
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'

const { utils: sshUtils } = ssh2

import type { HetznerDeployableConfig } from '@/config/types.ts'
import type { InfraStorageRuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

import { createHetznerTarget } from './create-hetzner-target.ts'

let TEST_PRIVATE_KEY: string
let TEST_PUBLIC_LINE: string

beforeAll(() => {
	const kp = sshUtils.generateKeyPairSync('ed25519')
	TEST_PRIVATE_KEY = kp.private
	const parsed = sshUtils.parseKey(TEST_PRIVATE_KEY)
	if (parsed instanceof Error) throw parsed
	if (Array.isArray(parsed)) throw new Error('unexpected multi-key parse')
	TEST_PUBLIC_LINE = `${parsed.type} ${parsed.getPublicSSH().toString('base64')}`
})

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
		internal: false,
	},
	scripts: { lint: false, test: false, build: false },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'hetzner-vps',
		secrets: [],
		hetzner: { serverType: 'cpx22', location: 'nbg1' },
	},
	services: {},
}

const FAKE_INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

function stubHetznerEnv(): void {
	vi.stubEnv('HETZNER_API_TOKEN', 'hcloud')
	vi.stubEnv(
		'DEPLOY_SSH_PRIVATE_KEY_B64',
		Buffer.from(TEST_PRIVATE_KEY).toString('base64'),
	)
	vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey')
	vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
}

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('createHetznerTarget', () => {
	it('wires credentials from env into the target config', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				credentials: {
					hcloudToken: 'hcloud',
					deployPrivateKey: TEST_PRIVATE_KEY,
					deployPublicKey: TEST_PUBLIC_LINE,
					tailscaleAuthKey: 'tskey',
				},
			}),
		)
	})

	it('passes through the injected InfraStorageRuntimeConfig', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({ infraStorage: FAKE_INFRA_STORAGE }),
		)
	})

	it('derives the public key from the private key', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		const call = vi.mocked(HetznerVpsTarget).mock.calls[0]?.[0]
		expect(call?.credentials.deployPublicKey).toMatch(
			/^ssh-ed25519 [A-Za-z0-9+/=]+$/,
		)
		expect(call?.credentials.deployPublicKey).toBe(TEST_PUBLIC_LINE)
	})

	it('omits the vector block when NN_VL_URL is unset', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({ vector: null }),
		)
	})

	it('builds the vector block when NN_VL_URL is set', async () => {
		stubHetznerEnv()
		vi.stubEnv('NN_VL_URL', 'http://vl:9428')
		vi.stubEnv('NN_CLIENT_ID', 'nextnode')

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({
				vector: { clientId: 'nextnode', vlUrl: 'http://vl:9428' },
			}),
		)
	})

	it('throws when HETZNER_API_TOKEN is missing', () => {
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(TEST_PRIVATE_KEY).toString('base64'),
		)
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')

		expect(() =>
			createHetznerTarget(
				HETZNER_CONFIG,
				'production',
				FAKE_INFRA_STORAGE,
			),
		).toThrow('HETZNER_API_TOKEN env var is required')
	})

	it('throws when DEPLOY_SSH_PRIVATE_KEY_B64 is missing', () => {
		expect(() =>
			createHetznerTarget(
				HETZNER_CONFIG,
				'production',
				FAKE_INFRA_STORAGE,
			),
		).toThrow('DEPLOY_SSH_PRIVATE_KEY_B64 env var is required')
	})

	it('throws when NN_CLIENT_ID is missing but NN_VL_URL is set', () => {
		stubHetznerEnv()
		vi.stubEnv('NN_VL_URL', 'http://vl:9428')

		expect(() =>
			createHetznerTarget(
				HETZNER_CONFIG,
				'production',
				FAKE_INFRA_STORAGE,
			),
		).toThrow('NN_CLIENT_ID env var is required')
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing', () => {
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(TEST_PRIVATE_KEY).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey')

		expect(() =>
			createHetznerTarget(
				HETZNER_CONFIG,
				'production',
				FAKE_INFRA_STORAGE,
			),
		).toThrow('CLOUDFLARE_API_TOKEN env var is required')
	})

	it('passes cloudflareApiToken from env (used by Caddy ACME DNS-01)', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		expect(HetznerVpsTarget).toHaveBeenCalledWith(
			expect.objectContaining({ cloudflareApiToken: 'cf-token' }),
		)
	})

	it('wires a DnsClient with reconcile + deleteByName methods', async () => {
		stubHetznerEnv()

		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')

		createHetznerTarget(HETZNER_CONFIG, 'production', FAKE_INFRA_STORAGE)

		const call = vi.mocked(HetznerVpsTarget).mock.calls[0]?.[0]
		expect(typeof call?.dns.reconcile).toBe('function')
		expect(typeof call?.dns.deleteByName).toBe('function')
	})
})
