import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { httpError, okEmpty } from '#/test-fetch.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deployWorkers } from './deploy-workers.ts'

import type { ExecResult, WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { FetchImpl } from '#/test-fetch.ts'
import type { WorkersDeployInput } from './deploy-workers.ts'

const ok: ExecResult = { exitCode: 0, stdout: '', stderr: '' }

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/server/entry.mjs',
	...overrides,
})

function buildInput(
	services: Record<string, WorkerServiceConfig>,
	runner: WranglerRunner,
): WorkersDeployInput {
	return {
		projectName: 'my-worker',
		environment: 'production',
		domain: 'example.com',
		services,
		backingServices: {},
		cron: [],
		outputs: {
			kvNamespaceIds: {},
			queueIds: {},
			r2Buckets: {},
			r2CdnUrls: {},
		},
		secrets: {},
		secretOrigins: {},
		accountId: 'acct-123',
		wranglerRunner: runner,
		projectDir: '/project/app',
		// Skip the retry backoff so an exhausted smoke check fails immediately.
		smokeCheckSleep: () => Promise.resolve(),
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('deployWorkers smoke check', () => {
	it('fails the deploy when a routed service never passes /healthz', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>(() =>
				Promise.resolve(httpError(503, 'still starting')),
			),
		)
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		await expect(
			deployWorkers(
				buildInput({ web: worker({ url: 'example.com' }) }, runner),
			),
		).rejects.toThrow(/service "web".*HTTP 503 - still starting/s)
	})

	it('resolves when every routed service passes /healthz', async () => {
		const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(okEmpty()))
		vi.stubGlobal('fetch', fetchMock)
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		const deployResult = await deployWorkers(
			buildInput(
				{ web: worker({ url: 'example.com' }), queue: worker() },
				runner,
			),
		)

		expect(deployResult.projectName).toBe('my-worker')
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://example.com/healthz',
			expect.objectContaining({ method: 'GET' }),
		)
	})
})

const GUARD_HEADERS = join('dist', 'client', '_headers')
const GUARD_ROBOTS = join('dist', 'client', 'robots.txt')

describe('deployWorkers SEO guard injection', () => {
	let projectDir: string

	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>(() => Promise.resolve(okEmpty())),
		)
		projectDir = mkdtempSync(join(tmpdir(), 'nn-deploy-guard-'))
	})

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true })
	})

	function guardInput(
		services: Record<string, WorkerServiceConfig>,
		environment: AppEnvironment,
		runner: WranglerRunner,
	): WorkersDeployInput {
		return {
			...buildInput(services, runner),
			environment,
			projectDir,
		}
	}

	it('injects _headers + robots.txt into each asset dir before the deploy in non-prod', async () => {
		mkdirSync(join(projectDir, 'dist', 'client'), { recursive: true })
		mkdirSync(join(projectDir, 'admin'), { recursive: true })
		const guardExistsAtDeploy: Array<{ name: string; present: boolean }> =
			[]
		const runner = vi.fn<WranglerRunner>(async args => {
			const document: { name: string; assets?: { directory: string } } =
				JSON.parse(readFileSync(args[2] ?? '', 'utf8'))
			guardExistsAtDeploy.push({
				name: document.name,
				present:
					document.assets !== undefined &&
					existsSync(join(document.assets.directory, '_headers')),
			})
			return ok
		})

		await deployWorkers(
			guardInput(
				{
					web: worker({ url: 'example.com' }),
					admin: worker({
						url: 'admin.example.com',
						entry: 'admin/_worker.js/index.js',
					}),
				},
				'development',
				runner,
			),
		)

		expect(readFileSync(join(projectDir, GUARD_HEADERS), 'utf8')).toContain(
			'X-Robots-Tag: noindex',
		)
		expect(readFileSync(join(projectDir, GUARD_ROBOTS), 'utf8')).toContain(
			'Disallow: /',
		)
		expect(existsSync(join(projectDir, 'admin', '_headers'))).toBe(true)
		// Written to the absolutised assets dir before each service's upload.
		expect(guardExistsAtDeploy).toEqual([
			{ name: 'my-worker-development-web', present: true },
			{ name: 'my-worker-development-admin', present: true },
		])
	})

	it('writes no guard files in production', async () => {
		mkdirSync(join(projectDir, 'dist'), { recursive: true })
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		await deployWorkers(
			guardInput(
				{ web: worker({ url: 'example.com' }) },
				'production',
				runner,
			),
		)

		expect(existsSync(join(projectDir, GUARD_HEADERS))).toBe(false)
		expect(existsSync(join(projectDir, GUARD_ROBOTS))).toBe(false)
	})

	it('writes nothing for a service that ships no assets', async () => {
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		await deployWorkers(
			guardInput(
				{
					api: worker({
						url: 'api.example.com',
						entry: 'src/index.ts',
					}),
				},
				'development',
				runner,
			),
		)

		expect(existsSync(join(projectDir, '_headers'))).toBe(false)
		expect(existsSync(join(projectDir, GUARD_HEADERS))).toBe(false)
	})
})
