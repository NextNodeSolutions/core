import { logger } from '@nextnode-solutions/logger'

import { writeEnvVar } from '../adapters/github-env.ts'
import { loadConfig } from '../config/load.ts'
import { computeDeployEnv } from '../domain/deploy-env.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'

import { getEnv, requireEnv } from './env.ts'

export function deployEnvCommand(): void {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	if (environment === 'none') {
		logger.info('Skipping deploy-env: non-deployable project')
		return
	}

	const deployEnv = computeDeployEnv({
		projectType: config.project.type,
		environment,
		domain: config.project.domain,
		pagesProjectName: computePagesProjectName(
			config.project.name,
			environment,
		),
	})

	writeEnvVar('SITE_URL', deployEnv.SITE_URL)
	logger.info(`SITE_URL=${deployEnv.SITE_URL}`)
	logger.info('Deploy env written to GITHUB_ENV')
}
