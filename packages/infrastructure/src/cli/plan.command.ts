import { dirname } from 'node:path'

import { logger } from '@nextnode-solutions/logger'

import { writePlanOutputs } from '../adapters/plan-outputs.js'
import { loadConfig } from '../config/load.js'
import { resolveEnvironment } from '../domain/environment.js'
import { buildQualityMatrix } from '../domain/quality-matrix.js'

import { getEnv, requireEnv } from './env.js'

const PROD_GATE_COMMAND =
	'cd .infra/packages/infrastructure && pnpm exec tsx src/index.ts prod-gate'

export function planCommand(): void {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	logger.info(`Config: ${configPath}`)
	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Project dir: ${dirname(configPath)}`)

	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
	})
	writePlanOutputs({ config, tasks })
}
