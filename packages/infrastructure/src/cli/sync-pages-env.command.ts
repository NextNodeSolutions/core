import { logger } from '@nextnode-solutions/logger'

import { updatePagesEnvVars } from '../adapters/cloudflare-pages-env.ts'
import { loadConfig } from '../config/load.ts'
import { computeDeployEnv } from '../domain/deploy-env.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'

import { getEnv, requireEnv } from './env.ts'

function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false
	}
	return Object.values(value).every(v => typeof v === 'string')
}

function parseAllSecrets(raw: string): Record<string, string> {
	const parsed: unknown = JSON.parse(raw)
	if (!isStringRecord(parsed)) {
		throw new Error('ALL_SECRETS must be a JSON object with string values')
	}
	return parsed
}

function pickSecrets(
	allSecrets: Readonly<Record<string, string>>,
	names: ReadonlyArray<string>,
): Record<string, string> {
	const picked: Record<string, string> = {}

	for (const name of names) {
		const value = allSecrets[name]
		if (value === undefined) {
			throw new Error(
				`Secret "${name}" declared in deploy.secrets but not found in GitHub Secrets`,
			)
		}
		picked[name] = value
	}

	return picked
}

export async function syncPagesEnvCommand(): Promise<void> {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	if (environment === 'none') {
		logger.info('Skipping sync-pages-env: non-deployable project')
		return
	}

	const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
	const token = requireEnv('CLOUDFLARE_API_TOKEN')
	const pagesProjectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	const deployEnv = computeDeployEnv({
		projectType: config.project.type,
		environment,
		domain: config.project.domain,
		pagesProjectName,
	})

	const computed = { SITE_URL: deployEnv.SITE_URL }

	const declaredSecrets = config.deploy.secrets
	let secrets: Record<string, string> = {}

	if (declaredSecrets.length > 0) {
		const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
		secrets = pickSecrets(allSecrets, declaredSecrets)
	}

	logger.info(
		`Syncing env vars to Cloudflare Pages project "${pagesProjectName}"`,
	)
	logger.info(`Computed: ${Object.keys(computed).join(', ')}`)
	if (declaredSecrets.length > 0) {
		logger.info(`Secrets: ${declaredSecrets.join(', ')}`)
	}

	await updatePagesEnvVars(
		accountId,
		pagesProjectName,
		token,
		computed,
		secrets,
	)
	logger.info('Cloudflare Pages env vars synced')
}
