import { dirname } from 'node:path'

import { logger } from '@nextnode-solutions/logger'

import { writePlanOutputs } from '../adapters/plan-outputs.ts'
import { loadConfig } from '../config/load.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'
import { buildQualityMatrix } from '../domain/quality-matrix.ts'

import { getEnv, requireEnv } from './env.ts'

const PROD_GATE_COMMAND =
	'cd .infra/packages/infrastructure && node src/index.ts prod-gate'

export function planCommand(): void {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	const pagesProjectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	logger.info(`Config: ${configPath}`)
	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Pages project: ${pagesProjectName}`)
	logger.info(`Project dir: ${dirname(configPath)}`)

	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
	})
	writePlanOutputs({ config, pagesProjectName, tasks })
}
