import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	TeardownResult,
	VpsFullTeardownResult,
} from '../../domain/deploy/teardown-result.ts'

import type { SshSession } from './ssh/session.types.ts'
import type { HcloudProjectState } from './state/types.ts'
import { HetznerVpsTarget } from './target.ts'

function requireVpsScope(result: TeardownResult): VpsFullTeardownResult {
	if (result.kind !== 'vps' || result.scope !== 'vps') {
		throw new Error(
			`Expected kind=vps/scope=vps, got kind=${result.kind} scope=${result.scope}`,
		)
	}
	return result
}

// Mock hcloud-client (network boundary)
vi.mock(import('./api/client.ts'), async importOriginal => {
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
		findServerById: vi.fn(async () => ({
			id: 42,
			name: 'acme-web',
			status: 'running',
			public_net: { ipv4: { ip: '1.2.3.4' } },
		})),
		findServersByLabels: vi.fn(async () => []),
		findImagesByLabels: vi.fn(async () => []),
		createFirewall: vi.fn(async () => ({
			id: 99,
			name: 'acme-web-fw',
		})),
		applyFirewall: vi.fn(async () => undefined),
		assertServerTypeAvailable: vi.fn(async () => undefined),
		deleteServer: vi.fn(async () => undefined),
		findFirewallsByName: vi.fn(async () => []),
		deleteFirewall: vi.fn(async () => undefined),
	}
})

// Mock ssh-session (network boundary)
vi.mock(import('./ssh/session.ts'), async importOriginal => {
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

// Mock Tailscale OAuth adapter (network boundary)
vi.mock('../tailscale/oauth.ts', () => ({
	mintAuthkey: vi.fn(async () => ({
		key: 'tskey-auth-minted',
		expires: '2099-01-01T00:00:00Z',
	})),
	getTailnetIpByHostname: vi.fn(async () => '100.74.91.126'),
	deleteTailnetDevicesByHostname: vi.fn(async () => 0),
}))

// Mock node:timers/promises (sleep resolves instantly in tests)
vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(async () => undefined),
}))

// Mock Cloudflare DNS reconciliation (network boundary: Cloudflare API)
const { mockReconcileDnsRecords } = vi.hoisted(() => ({
	mockReconcileDnsRecords: vi.fn(async () => undefined),
}))
vi.mock('../cloudflare/dns/reconcile.ts', () => ({
	reconcileDnsRecords: mockReconcileDnsRecords,
}))

// Mock Cloudflare DNS delete (network boundary: Cloudflare API)
const { mockDeleteDnsRecordsByName } = vi.hoisted(() => ({
	mockDeleteDnsRecordsByName: vi.fn(async () => 0),
}))
vi.mock('../cloudflare/dns/delete-records.ts', () => ({
	deleteDnsRecordsByName: mockDeleteDnsRecordsByName,
}))

// Mock R2Client (network boundary)
const fakeR2State = new Map<string, string>()

vi.mock('../r2/client.ts', () => ({
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
		delete: vi.fn(async (key: string) => {
			fakeR2State.delete(key)
		}),
		exists: vi.fn(async (key: string) => fakeR2State.has(key)),
		deleteByPrefix: vi.fn(async () => 0),
	})),
}))

const HETZNER_CONFIG = { serverType: 'cpx22', location: 'nbg1' } as const

const R2_CONFIG = {
	accountId: 'acct',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
} as const

const CREDENTIALS = {
	hcloudToken: 'hcloud-token',
	deployPrivateKey: 'fake-private-key',
	deployPublicKey: 'ssh-ed25519 AAAA test@ci',
	tailscaleAuthKey: 'tskey-auth-test',
} as const

const TARGET_CONFIG = {
	hetzner: HETZNER_CONFIG,
	r2: R2_CONFIG,
	environment: 'production' as const,
	domain: 'acme-web.example.com',
	internal: false,
	credentials: CREDENTIALS,
	vector: {
		clientId: 'nextnode',
		vlUrl: 'http://vl.tail0.ts.net:9428',
	},
	cloudflareApiToken: 'cf-token',
	acmeEmail: 'test@example.com',
}

const CONVERGED_STATE: HcloudProjectState = {
	phase: 'converged',
	serverId: 42,
	publicIp: '1.2.3.4',
	tailnetIp: '100.74.91.126',
	convergedAt: '2026-04-17T10:00:00.000Z',
}

function seedState(state: HcloudProjectState = CONVERGED_STATE): void {
	fakeR2State.set('hetzner/acme-web.json', JSON.stringify(state))
}

function createMockSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		execWithStdin: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

beforeEach(() => {
	fakeR2State.clear()
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('HetznerVpsTarget', () => {
	describe('ensureInfra', () => {
		describe('fresh provision', () => {
			it('creates a VPS, writes state at each phase, and converges', async () => {
				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await target.ensureInfra('acme-web')

				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(stateJson).toBeDefined()
				const state: unknown = JSON.parse(stateJson!)
				expect(state).toEqual(
					expect.objectContaining({
						phase: 'converged',
						serverId: 42,
						publicIp: '1.2.3.4',
						tailnetIp: '100.74.91.126',
					}),
				)
			})

			it('returns a VpsProvisionResult with server details', async () => {
				const target = new HetznerVpsTarget(TARGET_CONFIG)

				const result = await target.ensureInfra('acme-web')

				expect(result).toEqual(
					expect.objectContaining({
						kind: 'vps',
						serverId: 42,
						serverType: 'cpx22',
						location: 'nbg1',
						publicIp: '1.2.3.4',
						tailnetIp: '100.74.91.126',
					}),
				)
				expect(result.durationMs).toBeGreaterThanOrEqual(0)
			})

			it('passes correct serverType and location to createServer', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')

				const target = new HetznerVpsTarget(TARGET_CONFIG)
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
					await import('./api/client.ts')

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).toHaveBeenCalledWith(
					'hcloud-token',
					expect.objectContaining({ image: 'debian-12' }),
				)
			})

			it('passes project and managed_by labels', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).toHaveBeenCalledWith(
					'hcloud-token',
					expect.objectContaining({
						labels: { project: 'acme-web', managed_by: 'nextnode' },
					}),
				)
			})

			it('checks for orphan servers before creating', async () => {
				const { findServersByLabels: mockedFind } =
					await import('./api/client.ts')

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedFind).toHaveBeenCalledWith('hcloud-token', {
					project: 'acme-web',
					managed_by: 'nextnode',
				})
			})

			it('throws on orphan server detection', async () => {
				const { findServersByLabels: mockedFind } =
					await import('./api/client.ts')
				vi.mocked(mockedFind).mockResolvedValueOnce([
					{
						id: 99,
						name: 'acme-web',
						status: 'running',
						public_net: { ipv4: { ip: '9.9.9.9' } },
					},
				])

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					/Orphan server\(s\) detected.*IDs: 99/,
				)
			})

			it('propagates errors from server creation', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				vi.mocked(mockedCreate).mockRejectedValueOnce(
					new Error('Hetzner API create server: 422'),
				)

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API create server: 422',
				)
			})

			it('propagates errors from firewall creation', async () => {
				const { createFirewall: mockedFw } =
					await import('./api/client.ts')
				vi.mocked(mockedFw).mockRejectedValueOnce(
					new Error('Hetzner API create firewall: 422'),
				)

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API create firewall: 422',
				)
			})

			it('propagates errors from applying firewall', async () => {
				const { applyFirewall: mockedApply } =
					await import('./api/client.ts')
				vi.mocked(mockedApply).mockRejectedValueOnce(
					new Error('Hetzner API apply firewall: 500'),
				)

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'Hetzner API apply firewall: 500',
				)
			})

			it('writes created state before completing provisioning', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				// Make completeProvisioning fail to observe intermediate state
				const { createFirewall: mockedFw } =
					await import('./api/client.ts')
				vi.mocked(mockedFw).mockRejectedValueOnce(
					new Error('firewall fail'),
				)

				// Capture state after createServer writes it
				vi.mocked(mockedCreate).mockImplementationOnce(async () => ({
					id: 42,
					name: 'acme-web',
					status: 'initializing',
					public_net: { ipv4: { ip: '1.2.3.4' } },
				}))

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'firewall fail',
				)

				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(stateJson).toBeDefined()
				expect(JSON.parse(stateJson!)).toEqual({
					phase: 'created',
					serverId: 42,
					publicIp: '1.2.3.4',
				})
			})
		})

		describe('resume from created', () => {
			it('skips server creation and completes provisioning', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				seedState({
					phase: 'created',
					serverId: 42,
					publicIp: '1.2.3.4',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).not.toHaveBeenCalled()
			})

			it('reality-checks the server still exists', async () => {
				const { findServerById: mockedFind } =
					await import('./api/client.ts')
				seedState({
					phase: 'created',
					serverId: 42,
					publicIp: '1.2.3.4',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedFind).toHaveBeenCalledWith('hcloud-token', 42)
			})

			it('advances to converged after completing all steps', async () => {
				seedState({
					phase: 'created',
					serverId: 42,
					publicIp: '1.2.3.4',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(JSON.parse(stateJson!)).toEqual(
					expect.objectContaining({
						phase: 'converged',
						serverId: 42,
						publicIp: '1.2.3.4',
						tailnetIp: '100.74.91.126',
					}),
				)
			})
		})

		describe('resume from provisioned', () => {
			it('skips server creation and provisioning, only converges', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				const { converge: mockedConverge } =
					await import('../../cli/hetzner/converge.ts')
				seedState({
					phase: 'provisioned',
					serverId: 42,
					publicIp: '1.2.3.4',
					tailnetIp: '100.74.91.126',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).not.toHaveBeenCalled()
				expect(mockedConverge).toHaveBeenCalled()
			})

			it('advances to converged', async () => {
				seedState({
					phase: 'provisioned',
					serverId: 42,
					publicIp: '1.2.3.4',
					tailnetIp: '100.74.91.126',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(JSON.parse(stateJson!)).toEqual(
					expect.objectContaining({
						phase: 'converged',
						serverId: 42,
						tailnetIp: '100.74.91.126',
					}),
				)
			})
		})

		describe('resume from converged', () => {
			it('skips VPS creation when state is converged', async () => {
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				seedState()

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedCreate).not.toHaveBeenCalled()
			})

			it('still runs convergence when state is converged', async () => {
				const { converge: mockedConverge } =
					await import('../../cli/hetzner/converge.ts')
				seedState()

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedConverge).toHaveBeenCalled()
			})

			it('uses tailnet IP from state for the convergence SSH session', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh/session.ts')
				seedState({
					...CONVERGED_STATE,
					tailnetIp: '100.99.88.77',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedSsh).toHaveBeenCalledWith(
					expect.objectContaining({ host: '100.99.88.77' }),
				)
			})
		})

		describe('stale state recovery', () => {
			it('wipes state and re-provisions when server is 404', async () => {
				const { findServerById: mockedFind } =
					await import('./api/client.ts')
				const { createServer: mockedCreate } =
					await import('./api/client.ts')
				vi.mocked(mockedFind).mockResolvedValueOnce(null)
				seedState()

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				// Should have deleted stale state then created a new server
				expect(mockedCreate).toHaveBeenCalled()
				// Final state should be converged with the new server
				const stateJson = fakeR2State.get('hetzner/acme-web.json')
				expect(JSON.parse(stateJson!)).toEqual(
					expect.objectContaining({ phase: 'converged' }),
				)
			})
		})

		describe('convergence', () => {
			it('closes SSH session even when converge throws', async () => {
				const { converge: mockedConverge } =
					await import('../../cli/hetzner/converge.ts')
				const { createSshSession: mockedSsh } =
					await import('./ssh/session.ts')
				const mockSession = createMockSession()

				seedState()
				vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)
				vi.mocked(mockedConverge).mockRejectedValueOnce(
					new Error('converge failed'),
				)

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'converge failed',
				)
				expect(mockSession.close).toHaveBeenCalled()
			})

			it('propagates createSshSession errors from convergence', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh/session.ts')
				seedState()

				vi.mocked(mockedSsh).mockRejectedValueOnce(
					new Error('SSH key rejected'),
				)

				const target = new HetznerVpsTarget(TARGET_CONFIG)

				await expect(target.ensureInfra('acme-web')).rejects.toThrow(
					'SSH key rejected',
				)
			})

			it('passes tailnet IP and credentials to SSH session on re-run', async () => {
				const { createSshSession: mockedSsh } =
					await import('./ssh/session.ts')
				seedState({
					...CONVERGED_STATE,
					tailnetIp: '100.10.0.1',
				})

				const target = new HetznerVpsTarget(TARGET_CONFIG)
				await target.ensureInfra('acme-web')

				expect(mockedSsh).toHaveBeenCalledWith({
					host: '100.10.0.1',
					username: 'deploy',
					privateKey: 'fake-private-key',
				})
			})
		})
	})

	describe('deploy', () => {
		const DEPLOY_IMAGE = {
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc123',
		} as const

		const DEPLOY_INPUT = {
			secrets: { DATABASE_URL: 'postgres://db:5432' },
			image: DEPLOY_IMAGE,
			registryToken: 'ghs_fake_token',
		}

		const DEPLOY_ENV = { SITE_URL: 'https://acme-web.example.com' }

		it('throws when no state exists', async () => {
			const target = new HetznerVpsTarget(TARGET_CONFIG)

			await expect(
				target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV),
			).rejects.toThrow(
				'Invariant: expected deployable state for "acme-web"',
			)
		})

		it('throws when state is still in created phase', async () => {
			seedState({
				phase: 'created',
				serverId: 42,
				publicIp: '1.2.3.4',
			})

			const target = new HetznerVpsTarget(TARGET_CONFIG)

			await expect(
				target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV),
			).rejects.toThrow(
				'Invariant: expected deployable state for "acme-web"',
			)
		})

		it('SSHs to the tailnet IP from state', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			seedState({
				...CONVERGED_STATE,
				tailnetIp: '100.10.0.5',
			})

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockedSsh).toHaveBeenCalledWith(
				expect.objectContaining({ host: '100.10.0.5' }),
			)
		})

		it('writes .env with merged envVars and secrets', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockSession.writeFile).toHaveBeenCalledWith(
				'/opt/apps/acme-web/production/.env',
				expect.stringContaining(
					'SITE_URL=https://acme-web.example.com',
				),
			)
			expect(mockSession.writeFile).toHaveBeenCalledWith(
				'/opt/apps/acme-web/production/.env',
				expect.stringContaining('DATABASE_URL=postgres://db:5432'),
			)
		})

		it('writes compose.yaml with image and port mapping', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockSession.writeFile).toHaveBeenCalledWith(
				'/opt/apps/acme-web/production/compose.yaml',
				expect.stringContaining('ghcr.io/acme/web:sha-abc123'),
			)
			expect(mockSession.writeFile).toHaveBeenCalledWith(
				'/opt/apps/acme-web/production/compose.yaml',
				expect.stringContaining('127.0.0.1:8080:3000'),
			)
		})

		it('runs docker compose pull and up', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockSession.exec).toHaveBeenCalledWith(
				expect.stringContaining(
					"docker compose -p 'acme-web-production'",
				),
			)
			expect(mockSession.exec).toHaveBeenCalledWith(
				expect.stringContaining('pull'),
			)
			expect(mockSession.exec).toHaveBeenCalledWith(
				expect.stringContaining('up -d --remove-orphans'),
			)
		})

		it('pushes Caddy config with upstream for deployed environment', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockSession.writeFile).toHaveBeenCalledWith(
				'/etc/caddy/config.json',
				expect.stringContaining('acme-web.example.com'),
			)
		})

		it('reloads Caddy after writing config', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV)

			expect(mockSession.exec).toHaveBeenCalledWith(
				'caddy reload --config /etc/caddy/config.json',
			)
		})

		it('returns DeployResult with correct structure', async () => {
			seedState()

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const result = await target.deploy(
				'acme-web',
				DEPLOY_INPUT,
				DEPLOY_ENV,
			)

			expect(result.projectName).toBe('acme-web')
			expect(result.durationMs).toBeGreaterThanOrEqual(0)
			expect(result.deployedEnvironments).toHaveLength(1)
			expect(result.deployedEnvironments[0]).toEqual(
				expect.objectContaining({
					kind: 'container',
					name: 'production',
					url: 'https://acme-web.example.com',
					imageRef: DEPLOY_IMAGE,
				}),
			)
		})

		it('closes SSH session even when deploy throws', async () => {
			const { createSshSession: mockedSsh } =
				await import('./ssh/session.ts')
			const mockSession = createMockSession()
			seedState()
			vi.mocked(mockedSsh).mockResolvedValueOnce(mockSession)
			vi.mocked(mockSession.writeFile).mockRejectedValueOnce(
				new Error('SSH write failed'),
			)

			const target = new HetznerVpsTarget(TARGET_CONFIG)

			await expect(
				target.deploy('acme-web', DEPLOY_INPUT, DEPLOY_ENV),
			).rejects.toThrow('SSH write failed')
			expect(mockSession.close).toHaveBeenCalled()
		})
	})

	describe('reconcileDns', () => {
		it('throws when no state exists', async () => {
			const target = new HetznerVpsTarget(TARGET_CONFIG)

			await expect(
				target.reconcileDns('acme-web', 'acme-web.example.com'),
			).rejects.toThrow(
				'Invariant: expected deployable state for "acme-web"',
			)
		})

		it('computes A records from state publicIp and calls reconciler', async () => {
			seedState({ ...CONVERGED_STATE, publicIp: '5.6.7.8' })

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.reconcileDns('acme-web', 'acme-web.example.com')

			expect(mockReconcileDnsRecords).toHaveBeenCalledWith(
				[
					{
						zoneName: 'example.com',
						name: 'acme-web.example.com',
						type: 'A',
						content: '5.6.7.8',
						proxied: true,
						ttl: 1,
					},
				],
				'cf-token',
			)
		})

		it('uses dev subdomain for development environment', async () => {
			seedState({ ...CONVERGED_STATE, publicIp: '5.6.7.8' })

			const target = new HetznerVpsTarget({
				...TARGET_CONFIG,
				environment: 'development',
			})
			await target.reconcileDns('acme-web', 'acme-web.example.com')

			expect(mockReconcileDnsRecords).toHaveBeenCalledWith(
				[
					expect.objectContaining({
						name: 'dev.acme-web.example.com',
						proxied: false,
						ttl: 300,
					}),
				],
				'cf-token',
			)
		})

		it('propagates errors from the DNS reconciler', async () => {
			seedState()
			mockReconcileDnsRecords.mockRejectedValueOnce(
				new Error('Cloudflare zone not found'),
			)

			const target = new HetznerVpsTarget(TARGET_CONFIG)

			await expect(
				target.reconcileDns('acme-web', 'acme-web.example.com'),
			).rejects.toThrow('Cloudflare zone not found')
		})

		it('uses tailnet IP for internal projects', async () => {
			seedState({
				...CONVERGED_STATE,
				publicIp: '5.6.7.8',
				tailnetIp: '100.64.0.5',
			})

			const target = new HetznerVpsTarget({
				...TARGET_CONFIG,
				internal: true,
			})
			await target.reconcileDns('acme-web', 'acme-web.example.com')

			expect(mockReconcileDnsRecords).toHaveBeenCalledWith(
				[
					expect.objectContaining({
						content: '100.64.0.5',
						proxied: false,
					}),
				],
				'cf-token',
			)
		})
	})

	describe('teardown', () => {
		beforeEach(async () => {
			const { findServerById: mockedFind } =
				await import('./api/client.ts')
			vi.mocked(mockedFind).mockResolvedValue(null)
		})

		it('deletes all resources when state exists', async () => {
			seedState()
			const { deleteServer: mockedDelete } =
				await import('./api/client.ts')
			const { findFirewallsByName: mockedFindFw } =
				await import('./api/client.ts')
			const { deleteTailnetDevicesByHostname: mockedTailscale } =
				await import('../tailscale/oauth.ts')
			vi.mocked(mockedFindFw).mockResolvedValueOnce([
				{ id: 99, name: 'acme-web-fw' },
			])
			vi.mocked(mockedTailscale).mockResolvedValueOnce(1)
			mockDeleteDnsRecordsByName.mockResolvedValueOnce(1)

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const raw = await target.teardown(
				'acme-web',
				'acme-web.example.com',
				'vps',
			)
			const result = requireVpsScope(raw)

			expect(result.outcome.server.handled).toBe(true)
			expect(result.outcome.server.detail).toContain('#42')
			expect(result.outcome.firewall.handled).toBe(true)
			expect(result.outcome.tailscale.handled).toBe(true)
			expect(result.outcome.dns.handled).toBe(true)
			expect(result.outcome.state.handled).toBe(true)
			expect(mockedDelete).toHaveBeenCalledWith('hcloud-token', 42)
		})

		it('reports server as already gone when no state and no orphans', async () => {
			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const result = requireVpsScope(
				await target.teardown(
					'acme-web',
					'acme-web.example.com',
					'vps',
				),
			)

			expect(result.outcome.server.handled).toBe(false)
			expect(result.outcome.server.detail).toBe('already gone')
		})

		it('deletes orphan servers found by labels when no state exists', async () => {
			const { findServersByLabels: mockedFind } =
				await import('./api/client.ts')
			const { deleteServer: mockedDelete } =
				await import('./api/client.ts')
			vi.mocked(mockedFind).mockResolvedValueOnce([
				{
					id: 99,
					name: 'acme-web',
					status: 'running',
					public_net: { ipv4: { ip: '9.9.9.9' } },
				},
			])

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const result = requireVpsScope(
				await target.teardown(
					'acme-web',
					'acme-web.example.com',
					'vps',
				),
			)

			expect(result.outcome.server.handled).toBe(true)
			expect(result.outcome.server.detail).toContain('orphan')
			expect(mockedDelete).toHaveBeenCalledWith('hcloud-token', 99)
		})

		it('reports firewall as not found when it does not exist', async () => {
			seedState()

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const result = requireVpsScope(
				await target.teardown(
					'acme-web',
					'acme-web.example.com',
					'vps',
				),
			)

			expect(result.outcome.firewall.handled).toBe(false)
			expect(result.outcome.firewall.detail).toBe('not found')
		})

		it('skips DNS when no domain is configured', async () => {
			seedState()

			const target = new HetznerVpsTarget({
				...TARGET_CONFIG,
				domain: 'acme-web.example.com',
			})
			const result = requireVpsScope(
				await target.teardown('acme-web', undefined, 'vps'),
			)

			expect(result.outcome.dns.handled).toBe(false)
			expect(result.outcome.dns.detail).toBe('no domain configured')
			expect(mockDeleteDnsRecordsByName).not.toHaveBeenCalled()
		})

		it('deletes R2 state', async () => {
			seedState()

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			await target.teardown('acme-web', 'acme-web.example.com', 'vps')

			expect(fakeR2State.has('hetzner/acme-web.json')).toBe(false)
		})

		it('returns a VpsTeardownResult with correct duration', async () => {
			seedState()

			const target = new HetznerVpsTarget(TARGET_CONFIG)
			const result = requireVpsScope(
				await target.teardown(
					'acme-web',
					'acme-web.example.com',
					'vps',
				),
			)

			expect(result.durationMs).toBeGreaterThanOrEqual(0)
		})
	})
})
