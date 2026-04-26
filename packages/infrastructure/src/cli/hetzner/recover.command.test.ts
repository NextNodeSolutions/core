import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
	RecoverOrphanInput,
	RecoverOrphanResult,
} from '../../adapters/hetzner/recover-orphan.ts'

import { recoverCommand } from './recover.command.ts'

vi.mock(import('../r2/load-runtime.ts'), async () => ({
	loadR2Runtime: vi.fn(async () => ({
		accountId: 'acct',
		endpoint: 'https://r2.example.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	})),
}))

const { mockFindServersByLabels } = vi.hoisted(() => ({
	mockFindServersByLabels: vi.fn(),
}))
vi.mock('../../adapters/hetzner/api/server.ts', () => ({
	findServersByLabels: mockFindServersByLabels,
	deleteServer: vi.fn(async () => undefined),
	findServerById: vi.fn(async () => null),
}))

const { mockRecoverOrphanVps } = vi.hoisted(() => ({
	mockRecoverOrphanVps:
		vi.fn<(input: RecoverOrphanInput) => Promise<RecoverOrphanResult>>(),
}))
vi.mock('../../adapters/hetzner/recover-orphan.ts', () => ({
	recoverOrphanVps: mockRecoverOrphanVps,
}))

const { mockExists } = vi.hoisted(() => ({
	mockExists: vi.fn<(key: string) => Promise<boolean>>(),
}))
vi.mock('../../adapters/r2/client.ts', () => ({
	R2Client: vi.fn(() => ({
		get: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
		exists: mockExists,
		deleteByPrefix: vi.fn(async () => 0),
	})),
}))

function tmpSummaryFile(): string {
	return `${process.env['TMPDIR'] ?? '/tmp'}/recover-summary-${String(Date.now())}-${String(Math.random()).slice(2)}.md`
}

const SERVER_FIXTURE = (
	id: number,
	vpsName: string | undefined,
): {
	id: number
	name: string
	status: string
	labels: Record<string, string>
	public_net: { ipv4: { ip: string } }
} => ({
	id,
	name: `srv-${String(id)}`,
	status: 'running',
	labels: vpsName
		? { managed_by: 'nextnode', vps: vpsName }
		: { managed_by: 'nextnode' },
	public_net: { ipv4: { ip: '1.2.3.4' } },
})

describe('recoverCommand', () => {
	let summaryPath: string

	beforeEach(() => {
		summaryPath = tmpSummaryFile()
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryPath)
		vi.stubEnv('LOG_LEVEL', 'silent')
		mockExists.mockReset()
		mockRecoverOrphanVps.mockReset()
		mockFindServersByLabels.mockReset()
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('reports no orphans when every server has matching state', async () => {
		mockFindServersByLabels.mockResolvedValue([SERVER_FIXTURE(1, 'foo')])
		mockExists.mockResolvedValue(true)

		await recoverCommand()

		expect(mockRecoverOrphanVps).not.toHaveBeenCalled()
		const summary = readFileSync(summaryPath, 'utf8')
		expect(summary).toContain('No orphan VPS')
	})

	it('lists orphans without deleting when RECOVER_VPS_NAMES is unset', async () => {
		mockFindServersByLabels.mockResolvedValue([
			SERVER_FIXTURE(1, 'foo'),
			SERVER_FIXTURE(2, 'orphan-1'),
		])
		mockExists.mockImplementation(async (key: string) =>
			key.includes('foo'),
		)

		await recoverCommand()

		expect(mockRecoverOrphanVps).not.toHaveBeenCalled()
		const summary = readFileSync(summaryPath, 'utf8')
		expect(summary).toContain('1 orphan VPS detected')
		expect(summary).toContain('orphan-1')
		expect(summary).not.toContain('foo')
	})

	it('recovers all orphans when RECOVER_VPS_NAMES="*"', async () => {
		vi.stubEnv('RECOVER_VPS_NAMES', '*')
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		mockFindServersByLabels.mockResolvedValue([
			SERVER_FIXTURE(1, 'orphan-1'),
			SERVER_FIXTURE(2, 'orphan-2'),
		])
		mockExists.mockResolvedValue(false)
		mockRecoverOrphanVps.mockImplementation(async input => ({
			vpsName: input.orphan.vpsName,
			serversDeleted: input.orphan.serverIds,
			tailscaleDevicesPurged: 1,
			certObjectsDeleted: 3,
		}))

		await recoverCommand()

		expect(mockRecoverOrphanVps).toHaveBeenCalledTimes(2)
		const summary = readFileSync(summaryPath, 'utf8')
		expect(summary).toContain('Recovered 2 orphan VPS')
	})

	it('recovers only the named orphans when RECOVER_VPS_NAMES is comma-separated', async () => {
		vi.stubEnv('RECOVER_VPS_NAMES', 'orphan-1')
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		mockFindServersByLabels.mockResolvedValue([
			SERVER_FIXTURE(1, 'orphan-1'),
			SERVER_FIXTURE(2, 'orphan-2'),
		])
		mockExists.mockResolvedValue(false)
		mockRecoverOrphanVps.mockImplementation(async input => ({
			vpsName: input.orphan.vpsName,
			serversDeleted: input.orphan.serverIds,
			tailscaleDevicesPurged: 0,
			certObjectsDeleted: 0,
		}))

		await recoverCommand()

		expect(mockRecoverOrphanVps).toHaveBeenCalledTimes(1)
		const summary = readFileSync(summaryPath, 'utf8')
		expect(summary).toContain('orphan-1')
		expect(summary).toContain('Detected but not in')
		expect(summary).toContain('orphan-2')
	})

	it('groups multiple servers under the same vpsName as one orphan', async () => {
		vi.stubEnv('RECOVER_VPS_NAMES', '*')
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		mockFindServersByLabels.mockResolvedValue([
			SERVER_FIXTURE(1, 'orphan-1'),
			SERVER_FIXTURE(2, 'orphan-1'),
		])
		mockExists.mockResolvedValue(false)
		mockRecoverOrphanVps.mockImplementation(async input => ({
			vpsName: input.orphan.vpsName,
			serversDeleted: input.orphan.serverIds,
			tailscaleDevicesPurged: 0,
			certObjectsDeleted: 0,
		}))

		await recoverCommand()

		expect(mockRecoverOrphanVps).toHaveBeenCalledTimes(1)
		const call = mockRecoverOrphanVps.mock.calls[0]?.[0]
		expect(call?.orphan.vpsName).toBe('orphan-1')
		expect(call?.orphan.serverIds).toEqual([1, 2])
	})

	it('skips servers with no `vps` label and warns', async () => {
		mockFindServersByLabels.mockResolvedValue([
			SERVER_FIXTURE(99, undefined),
		])

		await recoverCommand()

		expect(mockRecoverOrphanVps).not.toHaveBeenCalled()
		const summary = readFileSync(summaryPath, 'utf8')
		expect(summary).toContain('No orphan VPS')
	})
})
