import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar } from '../../adapters/github/env.ts'
import type { DeployableConfig } from '../../config/types.ts'
import { computePagesProjectName } from '../../domain/cloudflare/pages-project-name.ts'
import { computeDeployEnv } from '../../domain/deploy/env.ts'
import type { StaticDeployConfig } from '../../domain/deploy/target.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv, requireEnv } from '../env.ts'

import { createTarget } from './create-target.ts'
import { parseAllSecrets, pickSecrets } from './secrets.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = await createTarget(config, environment)

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

	writeEnvVar('SITE_URL', deployEnv.SITE_URL)
	logger.info(`SITE_URL=${deployEnv.SITE_URL}`)

	const declaredSecrets = config.deploy.secrets
	let secrets: Record<string, string> = {}
	if (declaredSecrets.length > 0) {
		const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
		secrets = pickSecrets(allSecrets, declaredSecrets)
	}

	const hostname = config.project.domain
		? `${config.project.domain}`
		: `${pagesProjectName}.pages.dev`

	const deployConfig: StaticDeployConfig = {
		kind: 'static',
		projectName: config.project.name,
		environments: [
			{
				name: environment,
				hostname,
				envVars: { SITE_URL: deployEnv.SITE_URL },
				secrets,
			},
		],
	}

	const result = await target.deploy(deployConfig)
	logger.info(
		`Deploy complete for "${result.projectName}" in ${result.durationMs}ms`,
	)
}
