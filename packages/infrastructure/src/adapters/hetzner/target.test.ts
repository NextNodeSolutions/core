import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SshSession } from './ssh-session.types.ts'
import { HetznerVpsTarget } from './target.ts'

// Mock hcloud-client (network boundary)
vi.mock(import('./hcloud-client.ts'), async importOriginal => {
	const actual = await importOriginal()
	return {
		...actual,
		createServer: vi.fn(async () => ({
			id: 42,
			name: 'acme-web',
			status: 'running',
			public_net: { ipv4: { ip: '1.2.3.4' } },
		})),
		describeServer: vi.fn(async () => ({
			id: 42,
			name: 'acme-web',
			status: 'running',
			public_net: { ipv4: { ip: '1.2.3.4' } },
		})),
		createFirewall: vi.fn(async () => ({
			id: 99,
			name: 'acme-web-fw',
		})),
		applyFirewall: vi.fn(async () => undefined),
	}
})

// Mock ssh-session (network boundary)
vi.mock(import('./ssh-session.ts'), async importOriginal => {
	const actual = await importOriginal()
	return {
		...actual,
		createSshSession: vi.fn(async () => createMockSession()),
	}
})

// Mock converge (CLI orchestrator boundary)
vi.mock('../../cli/hetzner/converge.ts', () => ({
	converge: vi.fn(async () => undefined),
}))

// Mock node:timers/promises (sleep resolves instantly in tests)
vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(async () => undefined),
}))

// Mock R2Client (network boundary)
const fakeR2State = new Map<string, string>()

vi.mock('../r2/r2-client.ts', () => ({
	R2Client: vi.fn(() => ({
		get: vi.fn(async (key: string) => {
			const body = fakeR2State.get(key)
			if (!body) return null
			return { body, etag: 'etag-1' }
		}),
		put: vi.fn(async (key: string, body: string) => {
			fakeR2State.set(key, body)
			return 'etag-2'
		}),
		delete: vi.fn(async () => undefined),
		exists: vi.fn(async (key: string) => fakeR2State.has(key)),
	})),
}))

const HETZNER_CONFIG = { serverType: 'cpx22', location: 'nbg1' } as const

const EXISTING_STATE = {
	serverId: 42,
	ip: '1.2.3.4',
	tailnetHostname: 'acme-web.tail0.ts.net',
} as const

function stubEnvVars(): void {
	vi.stubEnv('HCLOUD_TOKEN', 'hcloud-token')
	vi.stubEnv('DEPLOY_SSH_PRIVATE_KEY', 'fake-private-key')
	vi.stubEnv('DEPLOY_SSH_PUBLIC_KEY', 'ssh-ed25519 AAAA test@ci')
	vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
	vi.stubEnv('R2_ENDPOINT', 'https://r2.example.com')
	vi.stubEnv('R2_ACCESS_KEY_ID', 'r2-key')
	vi.stubEnv('R2_SECRET_ACCESS_KEY', 'r2-secret')
	vi.stubEnv('R2_STATE_BUCKET', 'nextnode-state')
	vi.stubEnv('R2_CERTS_BUCKET', 'nextnode-certs')
	vi.stubEnv('NN_CLIENT_ID', 'nextnode')
	vi.stubEnv('NN_VL_URL', 'http://vl.tail0.ts.net:9428')
	vi.stubEnv('LOG_LEVEL', 'silent')
}

function seedState(ip = '1.2.3.4'): void {
	fakeR2State.set(
		'hetzner/acme-web.json',
		JSON.stringify({ ...EXISTING_STATE, ip }),
	)
}

function createMockSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
	}
}

beforeEach(() => {
	fakeR2State.clear()
	stubEnvVars()
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('HetznerVpsTarget', () => {
	describe('constructor', () => {
		it('throws when HCLOUD_TOKEN is missing', () => {
			vi.stubEnv('HCLOUD_TOKEN', '')

			expect(() => new HetznerVpsTarget(HETZNER_CONFIG)).toThrow(
				'HCLOUD_TOKEN env var is required',
			)
		})

		it('throws when DEPLOY_SSH_PRIVATE_KEY is missing', () => {
			vi.stubEnv('DEPLOY_SSH_PRIVATE_KEY', '')

			expect(() => new HetznerVpsTarget(HETZNER_CONFIG)).toThrow(
				'DEPLOY_SSH_PRIVATE_KEY env var is required',
			)
		})

		it('throws when R2_ENDPOINT is missing', () => {
			vi.stubEnv('R2_ENDPOINT', '')

			expect(() => new HetznerVpsTarget(HETZNER_CONFIG)).toThrow(
				'R2_ENDPOINT env var is required',
			)
		})
	})

	describe('ensureInfra', () => {
		describe('fresh provision', () => {
			it('creates a VPS, firewall, and writes state', async () => {
				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await target.ensureInfra('acme-web')

				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(stateJson).toBeDefined()
				const state: unknown = JSON.parse(stateJson!)
				expect(state).toEqual({
					serverId: 42,
					ip: '1.2.3.4',
					tailnetHostname: 'acme-web.tail0.ts.net',
				})
			})

			it('passes correct serverType and location to createServer', async () => {
				const { createServer: mockedCreate } =
					await import('./hcloud-client.ts')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).toHaveBeenCalledWith(
					'hcloud-token',
					expect.objectContaining({
						serverType: 'cpx22',
						location: 'nbg1',
					}),
				)
			})

			it('uses debian-12 as the server image', async () => {
				const { createServer: mockedCreate } =
					await import('./hcloud-client.ts')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).toHaveBeenCalledWith(
					'hcloud-token',
					expect.objectContaining({ image: 'debian-12' }),
				)
			})

			it('passes project and managed_by labels', async () => {
				const { createServer: mockedCreate } =
					await import('./hcloud-client.ts')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).toHaveBeenCalledWith(
					'hcloud-token',
					expect.objectContaining({
						labels: { project: 'acme-web', managed_by: 'nextnode' },
					}),
				)
			})

			it('propagates errors from server creation', async () => {
				const { createServer: mockedCreate } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedCreate).mockRejectedValueOnce(
					new Error('Hetzner API create server: 422'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API create server: 422',
				)
			})

			it('propagates errors from firewall creation', async () => {
				const { createFirewall: mockedFw } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedFw).mockRejectedValueOnce(
					new Error('Hetzner API create firewall: 422'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API create firewall: 422',
				)
			})

			it('propagates errors from applying firewall', async () => {
				const { applyFirewall: mockedApply } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedApply).mockRejectedValueOnce(
					new Error('Hetzner API apply firewall: 500'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API apply firewall: 500',
				)
			})
		})

		describe('existing state', () => {
			it('skips VPS creation when state already exists', async () => {
				const { createServer: mockedCreate } =
					await import('./hcloud-client.ts')
				seedState()

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).not.toHaveBeenCalled()
			})

			it('still runs convergence when state already exists', async () => {
				const { converge: mockedConverge } =
					await import('../../cli/hetzner/converge.ts')
				seedState()

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedConverge).toHaveBeenCalled()
			})

			it('uses IP from state for the convergence SSH session', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				seedState('5.6.7.8')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedSsh).toHaveBeenCalledWith(
					expect.objectContaining({ host: '5.6.7.8' }),
				)
			})
		})

		describe('server polling', () => {
			it('succeeds when server becomes running after retries', async () => {
				const { describeServer: mockedDescribe } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedDescribe)
					.mockResolvedValueOnce({
						id: 42,
						name: 'acme-web',
						status: 'initializing',
						public_net: { ipv4: { ip: '1.2.3.4' } },
					})
					.mockResolvedValueOnce({
						id: 42,
						name: 'acme-web',
						status: 'initializing',
						public_net: { ipv4: { ip: '1.2.3.4' } },
					})
					.mockResolvedValueOnce({
						id: 42,
						name: 'acme-web',
						status: 'running',
						public_net: { ipv4: { ip: '1.2.3.4' } },
					})

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(
					target.ensureInfra('acme-web'),
				).resolves.toBeUndefined()
			})

			it('throws when server never reaches running', async () => {
				const { describeServer: mockedDescribe } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedDescribe).mockResolvedValue({
					id: 42,
					name: 'acme-web',
					status: 'initializing',
					public_net: { ipv4: { ip: '1.2.3.4' } },
				})

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'did not reach "running" after 24 attempts',
				)
			})

			it('propagates describeServer errors mid-polling', async () => {
				const { describeServer: mockedDescribe } =
					await import('./hcloud-client.ts')
				vi.mocked(mockedDescribe)
					.mockResolvedValueOnce({
						id: 42,
						name: 'acme-web',
						status: 'initializing',
						public_net: { ipv4: { ip: '1.2.3.4' } },
					})
					.mockRejectedValueOnce(new Error('Hetzner API: 500'))

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API: 500',
				)
			})
		})

		describe('SSH readiness', () => {
			it('succeeds on first SSH attempt without retrying', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				// 1 call from waitForSsh (first attempt succeeds) + 1 from runConvergence
				expect(mockedSsh).toHaveBeenCalledTimes(2)
			})

			it('succeeds after transient SSH failures', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				const mockSession = createMockSession()

				vi.mocked(mockedSsh)
					.mockRejectedValueOnce(new Error('Connection refused'))
					.mockRejectedValueOnce(new Error('Connection refused'))
					.mockResolvedValueOnce(mockSession) // waitForSsh succeeds
					.mockResolvedValueOnce(mockSession) // runConvergence session

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(
					target.ensureInfra('acme-web'),
				).resolves.toBeUndefined()
			})

			it('throws when SSH never connects', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				vi.mocked(mockedSsh).mockRejectedValue(
					new Error('Connection refused'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'not reachable after 12 attempts',
				)
			})
		})

		describe('convergence', () => {
			it('closes SSH session even when converge throws', async () => {
				const { converge: mockedConverge } =
					await import('../../cli/hetzner/converge.ts')
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				const mockSession = createMockSession()

				seedState()
				vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)
				vi.mocked(mockedConverge).mockRejectedValueOnce(
					new Error('converge failed'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'converge failed',
				)
				expect(mockSession.close).toHaveBeenCalled()
			})

			it('propagates createSshSession errors from convergence', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				seedState()

				vi.mocked(mockedSsh).mockRejectedValueOnce(
					new Error('SSH key rejected'),
				)

				const target = new HetznerVpsTarget(HETZNER_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'SSH key rejected',
				)
			})

			it('passes correct host and credentials to SSH session', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh-session.ts')
				seedState('10.0.0.1')

				const target = new HetznerVpsTarget(HETZNER_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedSsh).toHaveBeenCalledWith({
					host: '10.0.0.1',
					username: 'root',
					privateKey: 'fake-private-key',
				})
			})
		})
	})

	describe('deploy', () => {
		it('throws because deploy is not yet implemented', async () => {
			const target = new HetznerVpsTarget(HETZNER_CONFIG)

			// @ts-expect-error -- deploy throws before reading config
			await expect(target.deploy({})).rejects.toThrow(
				'not yet implemented',
			)
		})

		it('error message identifies the hetzner-vps target', async () => {
			const target = new HetznerVpsTarget(HETZNER_CONFIG)

			// @ts-expect-error -- deploy throws before reading config
			await expect(target.deploy({})).rejects.toThrow('hetzner-vps')
		})
	})
})
