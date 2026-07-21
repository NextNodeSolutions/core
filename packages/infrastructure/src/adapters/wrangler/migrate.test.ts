import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { wranglerD1MigrationsApply } from './migrate.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const DOCUMENT: WranglerDocument = {
	name: 'proj-production-api',
	main: 'dist/_worker.js/index.js',
	compatibility_date: '2026-06-01',
	compatibility_flags: ['nodejs_compat'],
	d1_databases: [
		{
			binding: 'DB',
			database_name: 'proj-production-d1',
			database_id: 'db-uuid',
			migrations_dir: 'drizzle',
		},
	],
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
		const configPath = args[args.indexOf('--config') + 1] ?? ''
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

describe('wranglerD1MigrationsApply', () => {
	it('runs `d1 migrations apply <db> --remote --config` from cwd', async () => {
		const { runner, captured } = capturingRunner()

		await wranglerD1MigrationsApply({
			document: DOCUMENT,
			databaseName: 'proj-production-d1',
			runner,
			cwd: '/project/app',
		})

		const call = captured()
		expect(call.args).toEqual([
			'd1',
			'migrations',
			'apply',
			'proj-production-d1',
			'--remote',
			'--config',
			call.configPath,
		])
		expect(call.cwd).toBe('/project/app')
	})

	it('absolutises main and migrations_dir against the project dir', async () => {
		const { runner, captured } = capturingRunner()

		await wranglerD1MigrationsApply({
			document: DOCUMENT,
			databaseName: 'proj-production-d1',
			runner,
			cwd: '/project/app',
		})

		const { written } = captured()
		expect(written.main).toBe('/project/app/dist/_worker.js/index.js')
		expect(written.d1_databases?.[0]?.migrations_dir).toBe(
			'/project/app/drizzle',
		)
	})

	it('removes the ephemeral config file after a successful apply', async () => {
		const { runner, captured } = capturingRunner()

		await wranglerD1MigrationsApply({
			document: DOCUMENT,
			databaseName: 'proj-production-d1',
			runner,
			cwd: '/project/app',
		})

		expect(existsSync(captured().configPath)).toBe(false)
	})

	it('throws the wrangler stderr verbatim and cleans up on failure', async () => {
		const { runner, captured } = capturingRunner(1, 'migration 0003 failed')

		await expect(
			wranglerD1MigrationsApply({
				document: DOCUMENT,
				databaseName: 'proj-production-d1',
				runner,
				cwd: '/project/app',
			}),
		).rejects.toThrow(
			'wrangler d1 migrations apply (database "proj-production-d1") failed (exit 1):\nmigration 0003 failed',
		)

		expect(existsSync(captured().configPath)).toBe(false)
	})
})
