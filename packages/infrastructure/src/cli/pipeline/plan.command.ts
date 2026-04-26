import { dirname, join, relative } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writePlanOutputs } from '#/adapters/github/plan-outputs.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import type { NextNodeConfig } from '#/config/types.ts'
import { isDeployable } from '#/config/types.ts'
import { computePagesProjectName } from '#/domain/cloudflare/pages-project-name.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { buildQualityMatrix } from '#/domain/pipeline/quality-matrix.ts'

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

	const packageDir = computePackageDir()
	const buildDirectory = join(packageDir, DEFAULT_BUILD_OUTPUT)

	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Pages project: ${pagesProjectName}`)
	logger.info(`Package dir: ${packageDir}`)
	logger.info(`Build directory: ${buildDirectory}`)

	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
	})
	writePlanOutputs({
		config,
		pagesProjectName,
		tasks,
		buildDirectory,
		packageDir,
	})
}

function computePackageDir(): string {
	const configFilePath = requireEnv('PIPELINE_CONFIG_FILE')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	return relative(workspace, dirname(configFilePath))
}
