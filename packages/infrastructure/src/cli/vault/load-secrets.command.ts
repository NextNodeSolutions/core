import {
	maskSecret,
	writeSecretOutput,
	writeWarning,
} from '#/adapters/github/output.ts'
import { readAppEnvironment, requireGithubRepository } from '#/cli/env.ts'
import { VAULT_ROOT_PATH } from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { openPlatformVault, openProjectVault } from './open-vault.ts'

import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

// Step output carrying the repository's secrets as a JSON object - the payload
// `deploy` reads back as `PROJECT_SECRETS` and pushes to every Worker.
const PROJECT_SECRETS_OUTPUT = 'PROJECT_SECRETS'

async function loadPlatformSecrets(): Promise<void> {
	const vault = await openPlatformVault()
	const platformSecrets = await vault.listSecrets()
	const names = Object.keys(platformSecrets)
	if (!names.length) {
		throw new Error(
			'the CI project holds no secret - the platform credentials must be stored there before any pipeline can run',
		)
	}
	for (const [name, secretValue] of Object.entries(platformSecrets)) {
		writeSecretOutput(name, secretValue)
	}
	logger.info(
		`loaded ${names.length} platform secret(s) from the CI project: ${names.join(', ')}`,
	)
}

// A repository without a project deploys without touching its Workers'
// secrets: a static site needs none, and a forgotten membership must not wipe
// a live Worker. The output is left unset, and the warning annotates the run,
// so the cause is found in the run summary rather than in the Worker's logs.
async function loadProjectSecrets(environment: AppEnvironment): Promise<void> {
	const repoName = requireGithubRepository().name
	const lookup = await openProjectVault(
		repoName,
		environment,
		VAULT_ROOT_PATH,
	)
	if (lookup.kind === 'missing') {
		writeWarning(
			`no Infisical project named "${repoName}" is visible to the pipeline identity (visible: ${lookup.visible.join(', ') || 'none'}) - the Workers' secrets are left unchanged. Create the project and add the identity as a member (README, "Secrets").`,
		)
		return
	}
	const projectSecrets = await lookup.vault.listSecrets()
	// The secrets travel as one JSON output: mask each value on its own so it
	// stays redacted wherever a later step prints it individually.
	for (const secretValue of Object.values(projectSecrets)) {
		maskSecret(secretValue)
	}
	writeSecretOutput(PROJECT_SECRETS_OUTPUT, JSON.stringify(projectSecrets))
	logger.info(
		`loaded ${Object.keys(projectSecrets).length} secret(s) from project "${repoName}" for ${environment}: ${Object.keys(projectSecrets).join(', ')}`,
	)
}

/**
 * Read the job's secrets from the vault and expose them as masked step
 * outputs, replacing the `secrets` context: each platform secret becomes its
 * own output (`steps.<id>.outputs.<NAME>`), the repository's secrets one JSON
 * output. The read is live: a secret stored in Infisical is in the next run.
 */
export async function loadSecretsCommand(): Promise<void> {
	await loadPlatformSecrets()

	// A job asks for the repository's secrets by setting PIPELINE_ENVIRONMENT
	// on the step; without it only the platform secrets are loaded (jobs that
	// act on the infrastructure, not on the Workers).
	const environment = readAppEnvironment('PIPELINE_ENVIRONMENT')
	if (environment) await loadProjectSecrets(environment)
}
