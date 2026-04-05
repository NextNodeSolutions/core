import { dirname } from 'node:path'

import { logger } from '@nextnode-solutions/logger'

import { loadConfig } from './config/load.js'
import type { ProjectSection } from './config/schema.js'
import { writePlanOutputs } from './pipeline/plan.js'
import { prodGate } from './pipeline/prod-gate.js'
import { publishResult } from './pipeline/publish-result.js'
import { buildQualityMatrix } from './pipeline/quality.js'
import type { PipelineEnvironment } from './pipeline/quality.js'

const APP_ENVIRONMENTS = ['development', 'production'] as const
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number]

function isAppEnvironment(value: string): value is AppEnvironment {
	const envs: readonly string[] = APP_ENVIRONMENTS
	return envs.includes(value)
}

function resolveEnvironment(
	projectType: ProjectSection['type'],
): PipelineEnvironment {
	if (projectType === 'package') return 'none'

	const raw = process.env['PIPELINE_ENVIRONMENT']
	if (!raw || !isAppEnvironment(raw)) {
		throw new Error(
			`PIPELINE_ENVIRONMENT must be one of ${APP_ENVIRONMENTS.join(', ')} for ${projectType} projects (got: ${raw})`,
		)
	}
	return raw
}

function plan(): void {
	const configPath = process.env['PIPELINE_CONFIG_FILE']
	if (!configPath) {
		throw new Error('PIPELINE_CONFIG_FILE env var is required')
	}

	const config = loadConfig(configPath)
	const environment = resolveEnvironment(config.project.type)

	logger.info(`Config: ${configPath}`)
	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Project dir: ${dirname(configPath)}`)

	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
	})
	writePlanOutputs({ config, tasks })
}

type Command = () => void | Promise<void>

const COMMANDS: Record<string, Command> = {
	plan,
	'publish-result': publishResult,
	'prod-gate': prodGate,
}

const commandName = process.argv[2] ?? 'plan'
const command = COMMANDS[commandName]

if (!command) {
	throw new Error(
		`Unknown command: ${commandName}. Available: ${Object.keys(COMMANDS).join(', ')}`,
	)
}

await command()
