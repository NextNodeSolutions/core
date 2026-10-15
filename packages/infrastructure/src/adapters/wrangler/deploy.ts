import {
	buildWorkerSecretSync,
	removedSecretNames,
} from '#/domain/cloudflare/workers/secret-sync.ts'
import { isRecord } from '#/kernel/guards.ts'
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
	// The secrets this Worker must hold, exactly: synced right after the deploy
	// against the SAME ephemeral config (the Worker must exist first). Omitted
	// when the Worker's secrets are left as they are, so no secret call is made.
	readonly secrets?: Readonly<Record<string, string>>
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
			if (typeof input.secrets !== 'undefined') {
				await syncWorkerSecrets(
					configPath,
					input.secrets,
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

export interface WranglerSecretOptions {
	readonly cwd: string
	readonly workerName: string
}

// `wrangler secret list` prints a JSON array of `{ name, type }` by default.
// Only the names are read; the values never leave Cloudflare.
function parseSecretNames(stdout: string, workerName: string): string[] {
	const context = `wrangler secret list (worker "${workerName}")`
	const start = stdout.indexOf('[')
	if (start === -1) throw new Error(`${context}: no JSON array in the output`)
	const parsed: unknown = JSON.parse(stdout.slice(start))
	if (!Array.isArray(parsed)) {
		throw new Error(`${context}: output is not a JSON array`)
	}
	return parsed.map(entry => {
		if (!isRecord(entry) || typeof entry['name'] !== 'string') {
			throw new Error(`${context}: an entry is missing \`name\``)
		}
		return entry['name']
	})
}

async function listWorkerSecretNames(
	configPath: string,
	runner: WranglerRunner,
	options: WranglerSecretOptions,
): Promise<string[]> {
	const listExec = await runner(['secret', 'list', '--config', configPath], {
		cwd: options.cwd,
	})
	assertWranglerOk(listExec, `secret list (worker "${options.workerName}")`)
	return parseSecretNames(listExec.stdout, options.workerName)
}

/**
 * Make the Worker hold exactly `secrets`: list the names it holds, then one
 * `wrangler secret bulk --config` call sets every value and deletes every name
 * absent from `secrets` (a `null` value). The JSON travels on STDIN - never
 * argv (a secret in argv leaks to `ps` and CI logs) and never a file. A
 * non-zero exit throws the wrangler stderr verbatim.
 */
export async function syncWorkerSecrets(
	configPath: string,
	secrets: Readonly<Record<string, string>>,
	runner: WranglerRunner,
	options: WranglerSecretOptions,
): Promise<void> {
	const existingNames = await listWorkerSecretNames(
		configPath,
		runner,
		options,
	)
	const payload = buildWorkerSecretSync(secrets, existingNames)
	if (!Object.keys(payload).length) return

	const removed = removedSecretNames(payload)
	logger.info(
		`wrangler secret bulk "${options.workerName}": ${Object.keys(secrets).length} set${removed.length ? `, removed ${removed.join(', ')}` : ''}`,
	)
	const bulkExec = await runner(['secret', 'bulk', '--config', configPath], {
		cwd: options.cwd,
		stdin: JSON.stringify(payload),
	})
	assertWranglerOk(bulkExec, `secret bulk (worker "${options.workerName}")`)
}
