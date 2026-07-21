import { createLogger } from '@nextnode-solutions/logger'

import { withWranglerConfig } from './ephemeral-config.ts'
import { assertWranglerOk } from './runner.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

const CONFIG_DIR_PREFIX = 'nn-wrangler-cfg-'

export interface WranglerDeployInput {
	readonly document: WranglerDocument
	readonly runner: WranglerRunner
	// The project package directory (where the built bundle + assets live).
	// wrangler runs here and the absolutised paths resolve against it.
	readonly cwd: string
	// This worker's secrets as a JSON object (name -> value), uploaded via
	// `wrangler secret bulk` against the SAME ephemeral config right after the
	// deploy (the worker must exist first). Omitted when the worker declares no
	// secrets, so no bulk call is made and no secret ever touches argv or disk.
	readonly secretsJson?: string
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
	await withWranglerConfig(
		input.document,
		input.cwd,
		CONFIG_DIR_PREFIX,
		async configPath => {
			logger.info(`wrangler deploy "${input.document.name}" started`)
			const deployExec = await input.runner(
				['deploy', '--config', configPath],
				{ cwd: input.cwd },
			)
			assertWranglerOk(
				deployExec,
				`deploy (worker "${input.document.name}")`,
			)
			logger.info(`wrangler deploy "${input.document.name}" completed`)
			if (input.secretsJson !== undefined) {
				await wranglerSecretBulk(
					configPath,
					input.secretsJson,
					input.runner,
					{
						cwd: input.cwd,
						workerName: input.document.name,
					},
				)
			}
		},
	)
}

export interface WranglerSecretBulkOptions {
	readonly cwd: string
	readonly workerName: string
}

/**
 * Bulk-upload a worker's secrets with `wrangler secret bulk --config`, reading
 * the JSON object (name -> value) from STDIN - never argv (a secret in argv
 * leaks to `ps` and CI logs) and never a file. Runs against the same ephemeral
 * config the deploy used, so the target worker is unambiguous. A non-zero exit
 * throws the wrangler stderr verbatim.
 */
export async function wranglerSecretBulk(
	configPath: string,
	secretsJson: string,
	runner: WranglerRunner,
	options: WranglerSecretBulkOptions,
): Promise<void> {
	logger.info(`wrangler secret bulk "${options.workerName}" started`)
	const bulkExec = await runner(['secret', 'bulk', '--config', configPath], {
		cwd: options.cwd,
		stdin: secretsJson,
	})
	assertWranglerOk(bulkExec, `secret bulk (worker "${options.workerName}")`)
	logger.info(`wrangler secret bulk "${options.workerName}" completed`)
}
