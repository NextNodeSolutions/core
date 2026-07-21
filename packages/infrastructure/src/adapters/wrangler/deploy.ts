import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

const CONFIG_DIR_PREFIX = 'nn-wrangler-cfg-'
const CONFIG_FILENAME = 'wrangler.json'
const JSON_INDENT = 2

export interface WranglerDeployInput {
	readonly document: WranglerDocument
	readonly runner: WranglerRunner
	// The project package directory (where the built bundle + assets live).
	// wrangler runs here and the absolutised paths resolve against it.
	readonly cwd: string
}

function absolutise(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path)
}

// wrangler resolves `main` and `assets.directory` relative to the CONFIG file's
// directory. The config is written to an ephemeral temp dir (so the dev never
// commits one), which does not hold the built bundle - so absolutise both paths
// against the project dir before writing. wrangler accepts absolute paths.
function resolveDocumentPaths(
	document: WranglerDocument,
	cwd: string,
): WranglerDocument {
	return {
		...document,
		main: absolutise(document.main, cwd),
		...(document.assets === undefined
			? {}
			: {
					assets: {
						...document.assets,
						directory: absolutise(document.assets.directory, cwd),
					},
				}),
	}
}

/**
 * Deploy one Worker: write its generated config to an ephemeral JSON file
 * (removed in `finally`, never committed) and run `wrangler deploy --config`
 * from the project directory. A non-zero exit throws the wrangler stderr
 * verbatim so the CI log carries the actual provider error.
 */
export async function wranglerDeploy(
	input: WranglerDeployInput,
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
		logger.info(`wrangler deploy "${input.document.name}" started`)
		const deployExec = await input.runner(
			['deploy', '--config', configPath],
			{ cwd: input.cwd },
		)
		if (deployExec.exitCode !== 0) {
			throw new Error(
				`wrangler deploy (worker "${input.document.name}") failed (exit ${String(deployExec.exitCode)}):\n${deployExec.stderr}`,
			)
		}
		logger.info(`wrangler deploy "${input.document.name}" completed`)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}
