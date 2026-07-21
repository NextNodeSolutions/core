import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import { resolveDocumentPaths } from './config-paths.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

const CONFIG_DIR_PREFIX = 'nn-wrangler-d1-'
const CONFIG_FILENAME = 'wrangler.json'
const JSON_INDENT = 2

export interface WranglerD1MigrationsApplyInput {
	// The owning service's generated wrangler config, carrying the D1 binding
	// (database name + id) and `migrations_dir`. Written to an ephemeral file so
	// wrangler resolves the database and the local migrations to apply.
	readonly document: WranglerDocument
	// The D1 database name (`<project>-<env>-d1`) passed as the positional
	// argument. wrangler accepts the binding OR the name; the name is stable
	// (a binding can be renamed), so it is the deterministic choice.
	readonly databaseName: string
	readonly runner: WranglerRunner
	// The project package dir wrangler runs from (where the migrations live).
	readonly cwd: string
}

/**
 * Apply pending D1 migrations against the REMOTE database with
 * `wrangler d1 migrations apply <database> --remote --config <path>`. Writes the
 * owning service's generated config to an ephemeral JSON file (removed in
 * `finally`, never committed), absolutising its filesystem paths against the
 * project dir first. A non-zero exit throws the wrangler stderr verbatim so the
 * CI log carries the actual provider error.
 */
export async function wranglerD1MigrationsApply(
	input: WranglerD1MigrationsApplyInput,
): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), CONFIG_DIR_PREFIX))
	const configPath = join(dir, CONFIG_FILENAME)
	try {
		await writeFile(
			configPath,
			JSON.stringify(
				resolveDocumentPaths(input.document, input.cwd),
				null,
				JSON_INDENT,
			),
		)
		logger.info(
			`wrangler d1 migrations apply "${input.databaseName}" started`,
		)
		const applyExec = await input.runner(
			[
				'd1',
				'migrations',
				'apply',
				input.databaseName,
				'--remote',
				'--config',
				configPath,
			],
			{ cwd: input.cwd },
		)
		if (applyExec.exitCode !== 0) {
			throw new Error(
				`wrangler d1 migrations apply (database "${input.databaseName}") failed (exit ${String(applyExec.exitCode)}):\n${applyExec.stderr}`,
			)
		}
		logger.info(
			`wrangler d1 migrations apply "${input.databaseName}" completed`,
		)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}
