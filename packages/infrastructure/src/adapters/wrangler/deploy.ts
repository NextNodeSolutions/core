import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
	buildSecretDeletion,
	staleSecretNames,
} from '#/domain/cloudflare/workers/secret-sync.ts'
import { createLogger } from '@nextnode-solutions/logger'
import { array, object, string } from 'valibot'

import { withWranglerConfig } from './ephemeral-config.ts'
import { parseWranglerJsonArray } from './json-output.ts'
import { assertWranglerOk } from './runner.ts'

import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

const CONFIG_DIR_PREFIX = 'nn-wrangler-cfg-'
const SECRETS_FILENAME = 'secrets.json'
// Readable by the runner's user only, for the time of the deploy.
const SECRETS_FILE_MODE = 0o600

// `wrangler secret list` prints `[{ name, type }]`: only the names are read,
// the values never leave Cloudflare.
const secretNamesSchema = array(object({ name: string() }))

export interface WranglerDeployInput {
	readonly document: WranglerDocument
	readonly runner: WranglerRunner
	// The project package directory (where the built bundle + assets live).
	// wrangler runs here and the absolutised paths resolve against it.
	readonly cwd: string
	// The secrets this Worker must hold, exactly: uploaded with the code, then
	// the names absent from here are deleted. Omitted when the Worker's
	// secrets are left as they are, so no secret call is made.
	readonly secrets?: Readonly<Record<string, string>>
}

interface WorkerCommand {
	readonly configPath: string
	readonly cwd: string
	readonly workerName: string
	readonly runner: WranglerRunner
}

// The secrets travel in a file beside the ephemeral config, in the scratch
// directory `withWranglerConfig` removes: never argv (a value in argv leaks to
// `ps` and CI logs). An empty set uploads nothing: wrangler refuses an empty
// file, and the stale names are deleted afterwards anyway.
async function writeSecretsFile(
	configPath: string,
	secrets: Readonly<Record<string, string>> | undefined,
): Promise<ReadonlyArray<string>> {
	if (!secrets || !Object.keys(secrets).length) return []
	const path = join(dirname(configPath), SECRETS_FILENAME)
	await writeFile(path, JSON.stringify(secrets), { mode: SECRETS_FILE_MODE })
	return ['--secrets-file', path]
}

async function listWorkerSecretNames(
	command: WorkerCommand,
): Promise<ReadonlyArray<string>> {
	const label = `secret list (worker "${command.workerName}")`
	const listExec = await command.runner(
		['secret', 'list', '--config', command.configPath],
		{ cwd: command.cwd },
	)
	assertWranglerOk(listExec, label)
	return parseWranglerJsonArray(
		listExec.stdout,
		secretNamesSchema,
		label,
	).map(secret => secret.name)
}

// A name the Worker holds that `secrets` lacks is deleted by one
// `wrangler secret bulk` call reading `{ name: null }` on stdin. The call
// publishes a secrets-only version, so it is made only when a name is stale.
async function deleteStaleSecrets(
	command: WorkerCommand,
	secrets: Readonly<Record<string, string>>,
): Promise<void> {
	const stale = staleSecretNames(
		secrets,
		await listWorkerSecretNames(command),
	)
	if (!stale.length) return
	logger.info(
		`wrangler secret bulk "${command.workerName}": removing ${stale.join(', ')}`,
	)
	const bulkExec = await command.runner(
		['secret', 'bulk', '--config', command.configPath],
		{ cwd: command.cwd, stdin: JSON.stringify(buildSecretDeletion(stale)) },
	)
	assertWranglerOk(bulkExec, `secret bulk (worker "${command.workerName}")`)
}

/**
 * Deploy one Worker: write its generated config to an ephemeral JSON file
 * (removed in `finally`, never committed) and run `wrangler deploy --config`
 * from the project directory. The secrets upload with the code, as one
 * version: no version ever runs new code with old secrets or the reverse, and
 * a container's Durable Object is replaced once. A non-zero exit throws the
 * wrangler stderr verbatim so the CI log carries the actual provider error.
 */
export async function wranglerDeploy(
	input: WranglerDeployInput,
): Promise<void> {
	const workerName = input.document.name
	await withWranglerConfig(
		input.document,
		input.cwd,
		CONFIG_DIR_PREFIX,
		async configPath => {
			const command: WorkerCommand = {
				configPath,
				cwd: input.cwd,
				workerName,
				runner: input.runner,
			}
			const secretsArgs = await writeSecretsFile(
				configPath,
				input.secrets,
			)
			logger.info(`wrangler deploy "${workerName}" started`)
			const deployExec = await input.runner(
				['deploy', '--config', configPath, ...secretsArgs],
				{ cwd: input.cwd },
			)
			assertWranglerOk(deployExec, `deploy (worker "${workerName}")`)
			logger.info(`wrangler deploy "${workerName}" completed`)
			if (input.secrets) await deleteStaleSecrets(command, input.secrets)
		},
	)
}
