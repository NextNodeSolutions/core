import { createLogger } from '@nextnode-solutions/logger'

import { deployCommand } from './cli/deploy.command.ts'
import { dnsCommand } from './cli/dns.command.ts'
import { requireEnv } from './cli/env.ts'
import { planCommand } from './cli/plan.command.ts'
import { prodGateCommand } from './cli/prod-gate.command.ts'
import { provisionCommand } from './cli/provision.command.ts'
import { publishResultCommand } from './cli/publish-result.command.ts'
import { loadConfig } from './config/load.ts'
import type { DeployableConfig, NextNodeConfig } from './config/types.ts'
import { isDeployableConfig } from './config/types.ts'

const logger = createLogger()

type ConfigCommand = (config: NextNodeConfig) => void | Promise<void>
type DeployCommand = (config: DeployableConfig) => void | Promise<void>
type StandaloneCommand = () => void | Promise<void>

const PLAN_COMMANDS: Record<string, ConfigCommand> = {
	plan: planCommand,
}

const DEPLOY_COMMANDS: Record<string, DeployCommand> = {
	provision: provisionCommand,
	deploy: deployCommand,
	dns: dnsCommand,
}

const STANDALONE_COMMANDS: Record<string, StandaloneCommand> = {
	'prod-gate': prodGateCommand,
	'publish-result': publishResultCommand,
}

const ALL_COMMAND_NAMES = [
	...Object.keys(PLAN_COMMANDS),
	...Object.keys(DEPLOY_COMMANDS),
	...Object.keys(STANDALONE_COMMANDS),
]

const COMMAND_ARG_INDEX = 2

async function run(): Promise<void> {
	const commandName = process.argv[COMMAND_ARG_INDEX]
	if (!commandName) {
		throw new Error(
			`No command specified. Available: ${ALL_COMMAND_NAMES.join(', ')}`,
		)
	}

	const standalone = STANDALONE_COMMANDS[commandName]
	if (standalone) {
		await standalone()
		return
	}

	const config = loadConfig(requireEnv('PIPELINE_CONFIG_FILE'))

	const plan = PLAN_COMMANDS[commandName]
	if (plan) {
		await plan(config)
		return
	}

	const deploy = DEPLOY_COMMANDS[commandName]
	if (!deploy) {
		throw new Error(
			`Unknown command: ${commandName}. Available: ${ALL_COMMAND_NAMES.join(', ')}`,
		)
	}

	if (!isDeployableConfig(config)) {
		logger.info(`Skipping ${commandName}: non-deployable project`)
		return
	}

	await deploy(config)
}

await run()
