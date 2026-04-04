import { dirname } from 'node:path'

import { logger } from '@nextnode-solutions/logger'

import { loadConfig } from './config/load.js'
import { writePlanOutputs } from './pipeline/plan.js'
import { prodGate } from './pipeline/prod-gate.js'
import { publishResult } from './pipeline/publish-result.js'
import { buildQualityMatrix } from './pipeline/quality.js'

function plan(): void {
	const configPath = process.env['PIPELINE_CONFIG_FILE']
	if (!configPath) {
		throw new Error('PIPELINE_CONFIG_FILE env var is required')
	}

	const config = loadConfig(configPath)

	logger.info(`Config: ${configPath}`)
	logger.info(`Project: ${config.project.name}`)
	logger.info(`Project dir: ${dirname(configPath)}`)

	const tasks = buildQualityMatrix(config.scripts, config.project)
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
