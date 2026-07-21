import { existsSync, readFileSync } from 'node:fs'

import { okEmpty, notFound } from '#/test-fetch.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CloudflareWorkersTarget } from './target.ts'

import type {
	ExecResult,
	TerraformRunner,
} from '#/adapters/terraform/runner.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type {
	CloudflareWorkersDeployableConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { ServicesConfig } from '#/config/types.ts'
import type { DeployInput, DeployEnv } from '#/domain/deploy/target.ts'
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

// A wrangler runner keyed by worker name (args are ['delete','--name',<name>,'--force']).
function makeWrangler(
	behavior: Partial<Record<string, ExecResult>> = {},
): ReturnType<typeof vi.fn<WranglerRunner>> {
	return vi.fn<WranglerRunner>(async args => {
		const name = args[2] ?? ''
		return behavior[name] ?? ok()
	})
}

function buildTeardownTarget(input: {
	readonly services?: ServicesConfig
	readonly workers?: ReadonlyArray<string>
	readonly terraform: TerraformRunner
	readonly wrangler: WranglerRunner
}): CloudflareWorkersTarget {
	const base = buildConfig(input.services ?? {})
	const workerNames = input.workers ?? ['web']
	const services = Object.fromEntries(
		workerNames.map(name => [
			name,
			{
				secrets: [],
				needs: [],
				dependsOn: [],
				entry: 'dist/_worker.js/index.js',
			},
		]),
	)
	return new CloudflareWorkersTarget({
		accountId: 'acct-123',
		hcpToken: 'tf-token',
		environment: 'production',
		config: { ...base, deploy: { ...base.deploy, services } },
		terraformRunner: input.terraform,
		wranglerRunner: input.wrangler,
	})
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
	vi.useRealTimers()
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

describe('CloudflareWorkersTarget.planDiff', () => {
	it('runs terraform init before plan and returns the plan stdout', async () => {
		const planText = 'Plan: 2 to add, 0 to change, 0 to destroy.'
		const runner = makeRunner({
			plan: { exitCode: 2, stdout: planText, stderr: '' },
		})
		const target = buildTarget(BACKING_SERVICES, runner)

		await expect(target.planDiff()).resolves.toBe(planText)
		expect(runner.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'plan',
		])
	})

	it('runs a plan even when no backing services are declared', async () => {
		const runner = makeRunner({
			plan: { exitCode: 0, stdout: 'No changes.', stderr: '' },
		})
		const target = buildTarget({}, runner)

		await expect(target.planDiff()).resolves.toBe('No changes.')
		expect(runner.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'plan',
		])
	})

	it('removes the scratch workdir even when terraform plan fails', async () => {
		const runner = makeRunner({
			plan: { exitCode: 1, stdout: '', stderr: 'boom' },
		})
		const target = buildTarget(BACKING_SERVICES, runner)

		await expect(target.planDiff()).rejects.toThrow('terraform plan failed')

		const planCall = runner.mock.calls.find(call => call[0][0] === 'plan')
		expect(planCall).toBeDefined()
		if (planCall) expect(existsSync(cwdOf(planCall))).toBe(false)
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
	const snapshotInput = {
		projectName: 'my-worker',
		environment: 'production' as const,
	}

	it('throws a definitive error for prepareRollout', () => {
		expect(() =>
			target.prepareRollout(
				'my-worker',
				{ secrets: {}, secretOrigins: {}, registryToken: undefined },
				{ SITE_URL: 'https://example.com' },
			),
		).toThrow('prepareRollout is not applicable to cloudflare-workers')
	})

	it('rejects a container migrate input routed to the Workers target', async () => {
		await expect(
			target.runMigrate({
				kind: 'container',
				projectName: 'my-worker',
				environment: 'production',
				image: { registry: 'r', repository: 'x', tag: 't' },
				migrateCommand: 'm',
			}),
		).rejects.toThrow(
			'runMigrate on cloudflare-workers expects a d1 migrate input',
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
})

const DEPLOY_INPUT: DeployInput = {
	secrets: {},
	secretOrigins: {},
	registryToken: undefined,
}
const DEPLOY_ENV: DeployEnv = { SITE_URL: 'https://example.com' }

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

function buildDeployTarget(input: {
	readonly services: Record<string, WorkerServiceConfig>
	readonly backing?: ServicesConfig
	readonly terraform: TerraformRunner
	readonly wrangler: WranglerRunner
}): CloudflareWorkersTarget {
	const base = buildConfig(input.backing ?? {})
	return new CloudflareWorkersTarget({
		accountId: 'acct-123',
		hcpToken: 'tf-token',
		projectDir: '/project/app',
		environment: 'production',
		config: {
			...base,
			deploy: { ...base.deploy, services: input.services, cron: [] },
		},
		terraformRunner: input.terraform,
		wranglerRunner: input.wrangler,
	})
}

// A wrangler runner that records each deployed worker's config (name + path) by
// reading the ephemeral file while it still exists (deleted after the call).
function makeDeployWrangler(
	behavior: Partial<Record<string, ExecResult>> = {},
): {
	readonly runner: ReturnType<typeof vi.fn<WranglerRunner>>
	readonly deployed: Array<{ name: string; path: string }>
} {
	const deployed: Array<{ name: string; path: string }> = []
	const runner = vi.fn<WranglerRunner>(async args => {
		const path = args[2] ?? ''
		const document: { name: string } = JSON.parse(
			readFileSync(path, 'utf8'),
		)
		deployed.push({ name: document.name, path })
		return behavior[document.name] ?? ok()
	})
	return { runner, deployed }
}

describe('CloudflareWorkersTarget.deploy', () => {
	// Every routed service is smoke-checked on /healthz after deploy; stub it
	// healthy by default so the deploy assertions below are not gated on it.
	let healthzMock: ReturnType<typeof vi.fn<FetchImpl>>
	beforeEach(() => {
		healthzMock = vi.fn<FetchImpl>(() => Promise.resolve(okEmpty()))
		vi.stubGlobal('fetch', healthzMock)
	})

	it('deploys services in depends_on order (dependency first)', async () => {
		const terraform = makeRunner()
		const { runner, deployed } = makeDeployWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com', dependsOn: ['api'] }),
				api: worker(),
			},
			terraform,
			wrangler: runner,
		})

		const deployResult = await target.deploy(
			'my-worker',
			DEPLOY_INPUT,
			DEPLOY_ENV,
		)

		expect(deployed.map(d => d.name)).toEqual([
			'my-worker-production-api',
			'my-worker-production-web',
		])
		expect(terraform).not.toHaveBeenCalled()
		expect(deployResult.deployedEnvironments).toEqual([
			{
				kind: 'worker',
				name: 'production',
				url: 'https://example.com',
				workers: [
					{ name: 'api', url: '' },
					{ name: 'web', url: 'https://example.com' },
				],
				deployedAt: expect.any(Date),
			},
		])
	})

	it('reads the terraform outputs once for N services', async () => {
		const terraform = makeRunner()
		const { runner } = makeDeployWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com', needs: ['d1'] }),
				api: worker({ needs: ['d1'] }),
			},
			backing: BACKING_SERVICES,
			terraform,
			wrangler: runner,
		})

		await target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV)

		expect(terraform.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'output',
		])
	})

	it('removes every ephemeral wrangler config after deploy', async () => {
		const { runner, deployed } = makeDeployWrangler()
		const target = buildDeployTarget({
			services: { web: worker({ url: 'example.com' }) },
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV)

		for (const { path } of deployed) expect(existsSync(path)).toBe(false)
	})

	it('throws the wrangler error and stops when a deploy fails', async () => {
		const terraform = makeRunner()
		const { runner } = makeDeployWrangler({
			'my-worker-production-web': {
				exitCode: 1,
				stdout: '',
				stderr: 'boom',
			},
		})
		const target = buildDeployTarget({
			services: { web: worker({ url: 'example.com' }) },
			terraform,
			wrangler: runner,
		})

		await expect(
			target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV),
		).rejects.toThrow('wrangler deploy (worker "my-worker-production-web")')
	})

	it('throws when no project dir was resolved', async () => {
		const base = buildConfig({})
		const target = new CloudflareWorkersTarget({
			accountId: 'acct-123',
			hcpToken: 'tf-token',
			environment: 'production',
			config: {
				...base,
				deploy: {
					...base.deploy,
					services: { web: worker({ url: 'example.com' }) },
				},
			},
			terraformRunner: makeRunner(),
			wranglerRunner: makeDeployWrangler().runner,
		})

		await expect(
			target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV),
		).rejects.toThrow('needs the project directory')
	})

	it('smoke-checks each routed service on /healthz after deploying', async () => {
		const { runner } = makeDeployWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com' }),
				queue: worker(),
			},
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV)

		expect(healthzMock).toHaveBeenCalledTimes(1)
		expect(healthzMock).toHaveBeenCalledWith(
			'https://example.com/healthz',
			expect.objectContaining({ method: 'GET' }),
		)
	})
})

// A wrangler runner capturing `d1 migrations apply` calls: the positional
// database name, the full args, and the generated config (read while the
// ephemeral file still exists, deleted after the call).
function makeMigrateWrangler(behavior: ExecResult = ok()): {
	readonly runner: ReturnType<typeof vi.fn<WranglerRunner>>
	readonly calls: Array<{
		args: ReadonlyArray<string>
		cwd: string | undefined
		configPath: string
		document: {
			name: string
			main: string
			d1_databases?: ReadonlyArray<{
				database_name: string
				database_id: string
				migrations_dir?: string
			}>
		}
	}>
} {
	const calls: ReturnType<typeof makeMigrateWrangler>['calls'] = []
	const runner = vi.fn<WranglerRunner>(async (args, options) => {
		const configPath = args[args.indexOf('--config') + 1] ?? ''
		calls.push({
			args,
			cwd: options?.cwd,
			configPath,
			document: JSON.parse(readFileSync(configPath, 'utf8')),
		})
		return behavior
	})
	return { runner, calls }
}

describe('CloudflareWorkersTarget.runMigrate (D1)', () => {
	it('applies migrations against the owning service config, remote, and cleans up', async () => {
		const terraform = makeRunner()
		const { runner, calls } = makeMigrateWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com' }),
				api: worker({ needs: ['d1'] }),
			},
			backing: BACKING_SERVICES,
			terraform,
			wrangler: runner,
		})

		const migrateResult = await target.runMigrate({
			kind: 'd1',
			projectName: 'my-worker',
			environment: 'production',
		})

		expect(calls).toHaveLength(1)
		const [call] = calls
		if (call === undefined)
			expect.unreachable('runner should be called once')
		expect(call.args).toEqual([
			'd1',
			'migrations',
			'apply',
			'my-worker-production-d1',
			'--remote',
			'--config',
			call.configPath,
		])
		expect(call.cwd).toBe('/project/app')
		expect(call.document.d1_databases?.[0]).toEqual({
			binding: 'DB',
			database_name: 'my-worker-production-d1',
			database_id: 'db-uuid',
			migrations_dir: '/project/app/drizzle',
		})
		expect(existsSync(call.configPath)).toBe(false)
		expect(migrateResult.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('reads the terraform outputs (init + output) to resolve the database id', async () => {
		const terraform = makeRunner()
		const { runner } = makeMigrateWrangler()
		const target = buildDeployTarget({
			services: { api: worker({ needs: ['d1'] }) },
			backing: BACKING_SERVICES,
			terraform,
			wrangler: runner,
		})

		await target.runMigrate({
			kind: 'd1',
			projectName: 'my-worker',
			environment: 'production',
		})

		expect(terraform.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'output',
		])
	})

	it('throws the wrangler stderr verbatim when the apply fails', async () => {
		const { runner } = makeMigrateWrangler({
			exitCode: 1,
			stdout: '',
			stderr: 'migration 0003 failed',
		})
		const target = buildDeployTarget({
			services: { api: worker({ needs: ['d1'] }) },
			backing: BACKING_SERVICES,
			terraform: makeRunner(),
			wrangler: runner,
		})

		await expect(
			target.runMigrate({
				kind: 'd1',
				projectName: 'my-worker',
				environment: 'production',
			}),
		).rejects.toThrow('migration 0003 failed')
	})

	it('throws when no service declares needs = ["d1"]', async () => {
		const target = buildDeployTarget({
			services: { web: worker({ url: 'example.com' }) },
			backing: BACKING_SERVICES,
			terraform: makeRunner(),
			wrangler: makeMigrateWrangler().runner,
		})

		await expect(
			target.runMigrate({
				kind: 'd1',
				projectName: 'my-worker',
				environment: 'production',
			}),
		).rejects.toThrow('No deploy service declares needs = ["d1"]')
	})
})

// A wrangler runner that records deploy calls (worker name + generated vars, read
// while the ephemeral config still exists) and secret bulk calls (worker name +
// stdin JSON), each tagged with its invocation order.
function makeEnvWrangler(): {
	readonly runner: ReturnType<typeof vi.fn<WranglerRunner>>
	readonly deploys: Array<{
		name: string
		vars: Record<string, string>
		order: number
	}>
	readonly bulks: Array<{
		name: string
		secrets: Record<string, string>
		order: number
	}>
} {
	const deploys: Array<{
		name: string
		vars: Record<string, string>
		order: number
	}> = []
	const bulks: Array<{
		name: string
		secrets: Record<string, string>
		order: number
	}> = []
	let order = 0
	const runner = vi.fn<WranglerRunner>(async (args, options) => {
		const current = order++
		if (args[0] === 'secret') {
			const document: { name: string } = JSON.parse(
				readFileSync(args[3] ?? '', 'utf8'),
			)
			bulks.push({
				name: document.name,
				secrets: JSON.parse(options?.stdin ?? '{}'),
				order: current,
			})
			return ok()
		}
		const document: { name: string; vars?: Record<string, string> } =
			JSON.parse(readFileSync(args[2] ?? '', 'utf8'))
		deploys.push({
			name: document.name,
			vars: document.vars ?? {},
			order: current,
		})
		return ok()
	})
	return { runner, deploys, bulks }
}

describe('CloudflareWorkersTarget.deploy env & secrets', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>(() => Promise.resolve(okEmpty())),
		)
	})

	it('injects SITE_URL + peer URLs + needs-filtered backing vars into each config', async () => {
		const { runner, deploys } = makeEnvWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com', needs: ['d1'] }),
				api: worker(),
			},
			backing: BACKING_SERVICES,
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV)

		const web = deploys.find(d => d.name === 'my-worker-production-web')
		expect(web?.vars).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
			D1_DATABASE_ID: 'db-uuid',
		})
		const api = deploys.find(d => d.name === 'my-worker-production-api')
		// api needs nothing (no backing vars) but still sees the routed peer.
		expect(api?.vars).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
		})
	})

	it('runs secret bulk after the service deploy, with the projected secrets on stdin', async () => {
		const { runner, deploys, bulks } = makeEnvWrangler()
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com', secrets: ['JWT_SECRET'] }),
			},
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy(
			'my-worker',
			{
				secrets: { JWT_SECRET: 'jwt-val' },
				secretOrigins: {},
				registryToken: undefined,
			},
			DEPLOY_ENV,
		)

		expect(bulks).toEqual([
			{
				name: 'my-worker-production-web',
				secrets: { JWT_SECRET: 'jwt-val' },
				order: expect.any(Number),
			},
		])
		const webDeploy = deploys.find(
			d => d.name === 'my-worker-production-web',
		)
		expect(webDeploy?.order).toBeLessThan(bulks[0]?.order ?? -1)
	})

	it('projects each secret least-privilege: global to all, own only to its declarer', async () => {
		const { runner, bulks } = makeEnvWrangler()
		const target = buildDeployTarget({
			services: {
				// GLOBAL_SECRET is folded into every service upstream; RESEND is api-only.
				web: worker({ url: 'example.com', secrets: ['GLOBAL_SECRET'] }),
				api: worker({ secrets: ['GLOBAL_SECRET', 'RESEND_API_KEY'] }),
			},
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy(
			'my-worker',
			{
				secrets: {
					GLOBAL_SECRET: 'g-val',
					RESEND_API_KEY: 'r-val',
				},
				secretOrigins: {},
				registryToken: undefined,
			},
			DEPLOY_ENV,
		)

		const byName = Object.fromEntries(bulks.map(b => [b.name, b.secrets]))
		expect(byName['my-worker-production-web']).toEqual({
			GLOBAL_SECRET: 'g-val',
		})
		expect(byName['my-worker-production-api']).toEqual({
			GLOBAL_SECRET: 'g-val',
			RESEND_API_KEY: 'r-val',
		})
	})

	it('makes no secret bulk call for a service that declares no secrets', async () => {
		const { runner, bulks } = makeEnvWrangler()
		const target = buildDeployTarget({
			services: { web: worker({ url: 'example.com' }) },
			terraform: makeRunner(),
			wrangler: runner,
		})

		await target.deploy('my-worker', DEPLOY_INPUT, DEPLOY_ENV)

		expect(bulks).toEqual([])
	})

	it('throws the wrangler secret bulk stderr when the bulk upload fails', async () => {
		const runner = vi.fn<WranglerRunner>(async args => {
			if (args[0] === 'secret') {
				return { exitCode: 1, stdout: '', stderr: 'bulk-boom' }
			}
			return ok()
		})
		const target = buildDeployTarget({
			services: {
				web: worker({ url: 'example.com', secrets: ['JWT_SECRET'] }),
			},
			terraform: makeRunner(),
			wrangler: runner,
		})

		await expect(
			target.deploy(
				'my-worker',
				{
					secrets: { JWT_SECRET: 'jwt-val' },
					secretOrigins: {},
					registryToken: undefined,
				},
				DEPLOY_ENV,
			),
		).rejects.toThrow(
			'wrangler secret bulk (worker "my-worker-production-web") failed',
		)
	})
})

describe('CloudflareWorkersTarget.teardown', () => {
	it('deletes every worker script, then runs terraform destroy', async () => {
		const terraform = makeRunner()
		const wrangler = makeWrangler()
		const target = buildTeardownTarget({
			services: BACKING_SERVICES,
			workers: ['web', 'api'],
			terraform,
			wrangler,
		})

		const teardownResult = await target.teardown(
			'my-worker',
			'example.com',
			'project',
			false,
		)

		expect(teardownResult).toMatchObject({
			kind: 'workers',
			scope: 'project',
			outcome: {
				workers: { handled: true },
				terraform: { handled: true, detail: 'destroyed' },
			},
		})
		expect(wrangler.mock.calls.map(call => call[0][2])).toEqual([
			'my-worker-production-web',
			'my-worker-production-api',
		])
		expect(terraform.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'destroy',
		])
		const lastDeleteOrder = wrangler.mock.invocationCallOrder.at(-1) ?? 0
		const destroyOrder = terraform.mock.invocationCallOrder.at(-1) ?? 0
		expect(lastDeleteOrder).toBeLessThan(destroyOrder)
	})

	it('maps an already-gone worker to handled:false without throwing', async () => {
		const terraform = makeRunner()
		const wrangler = makeWrangler({
			'my-worker-production-web': {
				exitCode: 1,
				stdout: '',
				stderr: 'workers.api.error.script_not_found',
			},
		})
		const target = buildTeardownTarget({ terraform, wrangler })

		const teardownResult = await target.teardown(
			'my-worker',
			'example.com',
			'project',
			false,
		)

		if (teardownResult.kind !== 'workers') {
			expect.unreachable('expected a workers teardown result')
		}
		expect(teardownResult.outcome.workers).toEqual({
			handled: false,
			detail: 'already gone "my-worker-production-web"',
		})
		expect(terraform.mock.calls.map(call => call[0][0])).toEqual([
			'init',
			'destroy',
		])
	})

	it('throws and never runs terraform destroy when a wrangler delete fails', async () => {
		const terraform = makeRunner()
		const wrangler = makeWrangler({
			'my-worker-production-web': {
				exitCode: 1,
				stdout: '',
				stderr: 'Authentication error [code: 10000]',
			},
		})
		const target = buildTeardownTarget({ terraform, wrangler })

		await expect(
			target.teardown('my-worker', 'example.com', 'project', false),
		).rejects.toThrow(
			'wrangler delete --name my-worker-production-web failed',
		)
		expect(terraform).not.toHaveBeenCalled()
	})

	it('removes the scratch workdir even when terraform destroy throws', async () => {
		const terraform = makeRunner({
			destroy: { exitCode: 1, stdout: '', stderr: 'boom' },
		})
		const wrangler = makeWrangler()
		const target = buildTeardownTarget({
			services: BACKING_SERVICES,
			terraform,
			wrangler,
		})

		await expect(
			target.teardown('my-worker', 'example.com', 'project', false),
		).rejects.toThrow('terraform destroy failed')

		const destroyCall = terraform.mock.calls.find(
			call => call[0][0] === 'destroy',
		)
		expect(destroyCall).toBeDefined()
		if (destroyCall) expect(existsSync(cwdOf(destroyCall))).toBe(false)
	})

	it('never deletes the HCP workspace (makes no fetch call)', async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const target = buildTeardownTarget({
			services: BACKING_SERVICES,
			terraform: makeRunner(),
			wrangler: makeWrangler(),
		})

		await target.teardown('my-worker', 'example.com', 'project', false)

		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('CloudflareWorkersTarget.recover', () => {
	it('is a logged no-op that resolves without terraform or wrangler', async () => {
		const terraform = makeRunner()
		const wrangler = makeWrangler()
		const target = buildTeardownTarget({ terraform, wrangler })

		await expect(target.recover('my-worker')).resolves.toBeUndefined()
		expect(terraform).not.toHaveBeenCalled()
		expect(wrangler).not.toHaveBeenCalled()
	})
})
