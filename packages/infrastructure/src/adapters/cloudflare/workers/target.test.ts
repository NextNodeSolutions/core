import { existsSync } from 'node:fs'

import { okEmpty, notFound } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CloudflareWorkersTarget } from './target.ts'

import type {
	ExecResult,
	TerraformRunner,
} from '#/adapters/terraform/runner.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { ServicesConfig } from '#/config/types.ts'
import type { FetchImpl } from '#/test-fetch.ts'

const OUTPUTS_JSON = JSON.stringify({
	d1_database_id: { value: 'db-uuid' },
	kv_namespace_ids: { value: { sessions: 'ns-1' } },
	r2_buckets: { value: { assets: 'my-worker-production-assets' } },
	r2_cdn_urls: { value: { assets: 'https://assets.cdn.example.com' } },
})

function ok(stdout = ''): ExecResult {
	return { exitCode: 0, stdout, stderr: '' }
}

function makeRunner(
	behavior: Partial<Record<string, ExecResult>> = {},
): ReturnType<typeof vi.fn<TerraformRunner>> {
	return vi.fn<TerraformRunner>(async args => {
		const command = args[0] ?? ''
		return behavior[command] ?? ok(command === 'output' ? OUTPUTS_JSON : '')
	})
}

function buildConfig(
	services: ServicesConfig,
): CloudflareWorkersDeployableConfig {
	return {
		project: {
			type: 'app',
			name: 'my-worker',
			domain: 'example.com',
			redirectDomains: [],
			filter: false,
			internal: false,
		},
		scripts: { lint: 'lint', test: 'test', build: 'build' },
		package: false,
		environment: { development: true },
		services,
		deploy: {
			target: 'cloudflare-workers',
			generatedSecrets: [],
			secrets: [],
			vps: null,
			volumes: [],
			services: {
				web: {
					url: 'example.com',
					secrets: [],
					needs: [],
					dependsOn: [],
					entry: 'dist/_worker.js/index.js',
				},
			},
			cron: [],
		},
	}
}

const BACKING_SERVICES: ServicesConfig = {
	d1: { migrationsFolder: 'drizzle' },
	kv: { namespaces: [{ name: 'sessions' }] },
	r2: { buckets: [{ name: 'assets', cdn: true }] },
}

function buildTarget(
	services: ServicesConfig,
	runner: TerraformRunner,
): CloudflareWorkersTarget {
	return new CloudflareWorkersTarget({
		accountId: 'acct-123',
		hcpToken: 'tf-token',
		environment: 'production',
		config: buildConfig(services),
		terraformRunner: runner,
	})
}

function cwdOf(call: Parameters<TerraformRunner>): string {
	const cwd = call[1]?.cwd
	if (cwd === undefined) throw new Error('runner called without a cwd')
	return cwd
}

// The HCP workspace probe GETs (404 = absent) then POSTs to create; route by
// method so the GET never hits the "existing workspace" execution-mode parse.
function stubHcp(): ReturnType<typeof vi.fn<FetchImpl>> {
	const fetchMock = vi.fn<FetchImpl>((input, init) => {
		const method = init?.method ?? 'GET'
		return Promise.resolve(method === 'POST' ? okEmpty() : notFound())
	})
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})

describe('CloudflareWorkersTarget.contributeEnv', () => {
	it('returns the resolved SITE_URL and no secrets', () => {
		const target = buildTarget({}, makeRunner())
		expect(target.contributeEnv('my-worker')).toEqual({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		})
	})
})

describe('CloudflareWorkersTarget.ensureInfra', () => {
	it('ensures the HCP workspace, then runs terraform init before apply', async () => {
		const fetchMock = stubHcp()
		const runner = makeRunner()
		const target = buildTarget(BACKING_SERVICES, runner)

		const provisionResult = await target.ensureInfra('my-worker')

		expect(provisionResult.kind).toBe('workers')
		expect(provisionResult).toMatchObject({
			workspaceName: 'my-worker-production',
			outcome: {
				'hcp-workspace': { handled: true },
				terraform: { handled: true, detail: 'applied' },
			},
		})
		if (provisionResult.kind === 'workers') {
			expect(provisionResult.outcome['hcp-workspace'].detail).toContain(
				'created "my-worker-production"',
			)
		}

		const commands = runner.mock.calls.map(call => call[0][0])
		expect(commands).toEqual(['init', 'apply'])
		expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
			runner.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('passes TF_VAR_account_id to apply when account-scoped resources exist', async () => {
		stubHcp()
		const runner = makeRunner()
		const target = buildTarget(BACKING_SERVICES, runner)

		await target.ensureInfra('my-worker')

		const applyCall = runner.mock.calls.find(call => call[0][0] === 'apply')
		expect(applyCall?.[1]?.env).toEqual({ TF_VAR_account_id: 'acct-123' })
	})

	it('removes the scratch workdir even when terraform apply throws', async () => {
		stubHcp()
		const runner = makeRunner({
			apply: { exitCode: 1, stdout: '', stderr: 'boom' },
		})
		const target = buildTarget(BACKING_SERVICES, runner)

		await expect(target.ensureInfra('my-worker')).rejects.toThrow(
			'terraform apply failed',
		)

		const applyCall = runner.mock.calls.find(call => call[0][0] === 'apply')
		expect(applyCall).toBeDefined()
		if (applyCall) expect(existsSync(cwdOf(applyCall))).toBe(false)
	})
})

describe('CloudflareWorkersTarget.loadBackingEnv', () => {
	it('maps terraform outputs into a public ServiceEnv (init + output, no apply)', async () => {
		const runner = makeRunner()
		const target = buildTarget(BACKING_SERVICES, runner)

		const env = await target.loadBackingEnv('my-worker')

		expect(env).toEqual({
			public: {
				D1_DATABASE_ID: 'db-uuid',
				KV_NAMESPACE_SESSIONS_ID: 'ns-1',
				R2_BUCKET_ASSETS: 'my-worker-production-assets',
				R2_BUCKET_ASSETS_URL: 'https://assets.cdn.example.com',
				R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
			},
			secret: {},
		})
		expect(runner.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'output',
		])
	})

	it('removes the scratch workdir after reading outputs', async () => {
		const runner = makeRunner()
		const target = buildTarget(BACKING_SERVICES, runner)

		await target.loadBackingEnv('my-worker')

		const outputCall = runner.mock.calls.find(
			call => call[0][0] === 'output',
		)
		expect(outputCall).toBeDefined()
		if (outputCall) expect(existsSync(cwdOf(outputCall))).toBe(false)
	})

	it('returns an empty env without touching terraform when no backing declared', async () => {
		const runner = makeRunner()
		const target = buildTarget({}, runner)

		await expect(target.loadBackingEnv('my-worker')).resolves.toEqual({
			public: {},
			secret: {},
		})
		expect(runner).not.toHaveBeenCalled()
	})
})

describe('CloudflareWorkersTarget.reconcileDns', () => {
	it('is a no-op that resolves without terraform or fetch', async () => {
		const runner = makeRunner()
		const target = buildTarget(BACKING_SERVICES, runner)

		await expect(
			target.reconcileDns('my-worker', 'example.com'),
		).resolves.toBeUndefined()
		expect(runner).not.toHaveBeenCalled()
	})
})

describe('CloudflareWorkersTarget non-applicable methods', () => {
	const target = buildTarget(BACKING_SERVICES, makeRunner())
	const migrateInput = {
		projectName: 'my-worker',
		image: { registry: 'r', repository: 'x', tag: 't' },
		migrateCommand: 'm',
		environment: 'production' as const,
	}
	const snapshotInput = {
		projectName: 'my-worker',
		environment: 'production' as const,
	}

	it('throws a provisional error for deploy', () => {
		expect(() =>
			target.deploy(
				'my-worker',
				{ secrets: {}, secretOrigins: {}, registryToken: undefined },
				{ SITE_URL: 'https://example.com' },
			),
		).toThrow('deploy is not wired yet for cloudflare-workers')
	})

	it('throws a definitive error for prepareRollout', () => {
		expect(() =>
			target.prepareRollout(
				'my-worker',
				{ secrets: {}, secretOrigins: {}, registryToken: undefined },
				{ SITE_URL: 'https://example.com' },
			),
		).toThrow('prepareRollout is not applicable to cloudflare-workers')
	})

	it('throws a provisional error for runMigrate', () => {
		expect(() => target.runMigrate(migrateInput)).toThrow(
			'runMigrate is not wired yet for cloudflare-workers',
		)
	})

	it('throws a definitive error for runPreMigrateSnapshot', () => {
		expect(() => target.runPreMigrateSnapshot(snapshotInput)).toThrow(
			'runPreMigrateSnapshot is not applicable to cloudflare-workers',
		)
	})

	it('throws a definitive error for runAutoRestore', () => {
		expect(() =>
			target.runAutoRestore({
				projectName: 'my-worker',
				environment: 'production',
				snapshotCount: 0,
			}),
		).toThrow('runAutoRestore is not applicable to cloudflare-workers')
	})

	it('throws a definitive error for runFinalBackup', () => {
		expect(() => target.runFinalBackup(snapshotInput)).toThrow(
			'runFinalBackup is not applicable to cloudflare-workers',
		)
	})

	it('throws a provisional error for teardown', () => {
		expect(() =>
			target.teardown('my-worker', 'example.com', 'project', false),
		).toThrow('teardown is not wired yet for cloudflare-workers')
	})
})
