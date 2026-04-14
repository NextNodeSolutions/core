import { dirname, join, relative } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writePlanOutputs } from '../../adapters/github/plan-outputs.ts'
import type { NextNodeConfig } from '../../config/types.ts'
import { isDeployable } from '../../config/types.ts'
import { computePagesProjectName } from '../../domain/deploy/pages-project-name.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { buildQualityMatrix } from '../../domain/pipeline/quality-matrix.ts'
import { getEnv, requireEnv } from '../env.ts'

const PROD_GATE_COMMAND =
	'cd .infra/packages/infrastructure && node src/index.ts prod-gate'

const DEFAULT_BUILD_OUTPUT = 'dist'

export function planCommand(config: NextNodeConfig): void {
	const { type } = config.project
	const rawEnv = getEnv('PIPELINE_ENVIRONMENT')
	const environment = isDeployable(type)
		? resolveEnvironment(type, rawEnv)
		: resolveEnvironment(type, rawEnv)

	const pagesProjectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	const buildDirectory = computeBuildDirectory()

	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Pages project: ${pagesProjectName}`)
	logger.info(`Build directory: ${buildDirectory}`)

	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
	})
	writePlanOutputs({ config, pagesProjectName, tasks, buildDirectory })
}

function computeBuildDirectory(): string {
	const configFilePath = requireEnv('PIPELINE_CONFIG_FILE')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const configDir = relative(workspace, dirname(configFilePath))

	return join(configDir, DEFAULT_BUILD_OUTPUT)
}
