import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { wranglerDeploy, wranglerSecretBulk } from './deploy.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { ExecResult, WranglerRunner } from './runner.ts'

const DOCUMENT: WranglerDocument = {
	name: 'proj-production-web',
	main: 'dist/server/entry.mjs',
	compatibility_date: '2026-07-14',
	compatibility_flags: ['nodejs_compat'],
	assets: { directory: 'dist/client', binding: 'ASSETS' },
	observability: { enabled: true },
}

interface Captured {
	readonly args: ReadonlyArray<string>
	readonly cwd: string | undefined
	readonly configPath: string
	readonly written: WranglerDocument
}

function capturingRunner(
	exitCode = 0,
	stderr = '',
): {
	readonly runner: WranglerRunner
	readonly captured: () => Captured
} {
	let captured: Captured | undefined
	const runner: WranglerRunner = vi.fn(async (args, options) => {
		const configPath = args[2] ?? ''
		captured = {
			args,
			cwd: options?.cwd,
			configPath,
			written: JSON.parse(readFileSync(configPath, 'utf8')),
		}
		return { exitCode, stdout: '', stderr }
	})
	return {
		runner,
		captured: () => {
			if (!captured) throw new Error('runner not called')
			return captured
		},
	}
}

describe('wranglerDeploy', () => {
	it('writes the config, runs deploy from cwd, and absolutises paths', async () => {
		const { runner, captured } = capturingRunner()

		await wranglerDeploy({
			document: DOCUMENT,
			runner,
			cwd: '/project/app',
		})

		const call = captured()
		expect(call.args.slice(0, 2)).toEqual(['deploy', '--config'])
		expect(call.cwd).toBe('/project/app')
		expect(call.written.main).toBe('/project/app/dist/server/entry.mjs')
		expect(call.written.assets?.directory).toBe('/project/app/dist/client')
	})

	it('removes the ephemeral config file after a successful deploy', async () => {
		const { runner, captured } = capturingRunner()

		await wranglerDeploy({
			document: DOCUMENT,
			runner,
			cwd: '/project/app',
		})

		expect(existsSync(captured().configPath)).toBe(false)
	})

	it('leaves an already-absolute main untouched', async () => {
		const { runner, captured } = capturingRunner()
		const absolute: WranglerDocument = { ...DOCUMENT, main: '/abs/main.js' }

		await wranglerDeploy({
			document: absolute,
			runner,
			cwd: '/project/app',
		})

		expect(captured().written.main).toBe('/abs/main.js')
	})

	it('throws the wrangler stderr verbatim and cleans up on failure', async () => {
		const { runner, captured } = capturingRunner(1, 'boom')

		await expect(
			wranglerDeploy({ document: DOCUMENT, runner, cwd: '/project/app' }),
		).rejects.toThrow(
			'wrangler deploy (worker "proj-production-web") failed (exit 1):\nboom',
		)

		expect(existsSync(captured().configPath)).toBe(false)
	})
})

interface Call {
	readonly args: ReadonlyArray<string>
	readonly stdin: string | undefined
}

function recordingRunner(
	behavior: (call: number) => ExecResult = () => ({
		exitCode: 0,
		stdout: '',
		stderr: '',
	}),
): {
	readonly runner: WranglerRunner
	readonly calls: ReadonlyArray<Call>
} {
	const calls: Call[] = []
	const runner: WranglerRunner = vi.fn(async (args, options) => {
		const index = calls.length
		calls.push({ args, stdin: options?.stdin })
		return behavior(index)
	})
	return { runner, calls }
}

describe('wranglerDeploy with secretsJson', () => {
	it('runs secret bulk after deploy against the same config, secrets on stdin', async () => {
		const { runner, calls } = recordingRunner()
		const secretsJson = '{\n  "JWT_SECRET": "s"\n}'

		await wranglerDeploy({
			document: DOCUMENT,
			runner,
			cwd: '/project/app',
			secretsJson,
		})

		expect(calls).toHaveLength(2)
		const [deployCall, bulkCall] = calls
		expect(deployCall?.args.slice(0, 2)).toEqual(['deploy', '--config'])
		expect(bulkCall?.args.slice(0, 3)).toEqual([
			'secret',
			'bulk',
			'--config',
		])
		// Same ephemeral config file drives both.
		expect(bulkCall?.args[3]).toBe(deployCall?.args[2])
		expect(bulkCall?.stdin).toBe(secretsJson)
		expect(deployCall?.stdin).toBeUndefined()
	})

	it('makes no secret bulk call when secretsJson is omitted', async () => {
		const { runner, calls } = recordingRunner()

		await wranglerDeploy({
			document: DOCUMENT,
			runner,
			cwd: '/project/app',
		})

		expect(calls).toHaveLength(1)
		expect(calls[0]?.args.slice(0, 2)).toEqual(['deploy', '--config'])
	})

	it('throws the secret bulk stderr verbatim and cleans up when bulk fails', async () => {
		let bulkConfigPath = ''
		const { runner } = recordingRunner()
		const failingRunner: WranglerRunner = vi.fn(async (args, options) => {
			if (args[0] === 'secret') {
				bulkConfigPath = args[3] ?? ''
				return { exitCode: 1, stdout: '', stderr: 'bulk-boom' }
			}
			return runner(args, options)
		})

		await expect(
			wranglerDeploy({
				document: DOCUMENT,
				runner: failingRunner,
				cwd: '/project/app',
				secretsJson: '{"K":"v"}',
			}),
		).rejects.toThrow(
			'wrangler secret bulk (worker "proj-production-web") failed (exit 1):\nbulk-boom',
		)

		expect(existsSync(bulkConfigPath)).toBe(false)
	})
})

describe('wranglerSecretBulk', () => {
	it('pipes the JSON on stdin and never puts a secret in argv', async () => {
		const { runner, calls } = recordingRunner()

		await wranglerSecretBulk('/tmp/cfg.json', '{"K":"v"}', runner, {
			cwd: '/project/app',
			workerName: 'proj-production-web',
		})

		expect(calls[0]?.args).toEqual([
			'secret',
			'bulk',
			'--config',
			'/tmp/cfg.json',
		])
		expect(calls[0]?.stdin).toBe('{"K":"v"}')
	})

	it('throws the wrangler stderr verbatim on a non-zero exit', async () => {
		const { runner } = recordingRunner(() => ({
			exitCode: 1,
			stdout: '',
			stderr: 'nope',
		}))

		await expect(
			wranglerSecretBulk('/tmp/cfg.json', '{"K":"v"}', runner, {
				cwd: '/project/app',
				workerName: 'proj-production-web',
			}),
		).rejects.toThrow(
			'wrangler secret bulk (worker "proj-production-web") failed (exit 1):\nnope',
		)
	})
})
