import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { wranglerDeploy } from './deploy.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const DOCUMENT: WranglerDocument = {
	name: 'proj-production-web',
	main: 'dist/_worker.js/index.js',
	compatibility_date: '2026-06-01',
	compatibility_flags: ['nodejs_compat'],
	assets: { directory: 'dist', binding: 'ASSETS' },
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
			if (captured === undefined) throw new Error('runner not called')
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
		expect(call.written.main).toBe('/project/app/dist/_worker.js/index.js')
		expect(call.written.assets?.directory).toBe('/project/app/dist')
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
