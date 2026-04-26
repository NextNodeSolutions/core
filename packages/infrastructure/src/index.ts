import { createLogger } from '@nextnode-solutions/logger'

import { computeImageRefCommand } from './cli/deploy/compute-image-ref.command.ts'
import { deployCommand } from './cli/deploy/deploy.command.ts'
import { dnsCommand } from './cli/deploy/dns.command.ts'
import { provisionCommand } from './cli/deploy/provision.command.ts'
import { seoGuardCommand } from './cli/deploy/seo-guard.command.ts'
import { teardownGuardCommand } from './cli/deploy/teardown-guard.command.ts'
import { teardownCommand } from './cli/deploy/teardown.command.ts'
import { requireEnv } from './cli/env.ts'
import { buildGoldenImageCommand } from './cli/hetzner/build-golden-image.command.ts'
import { recoverCommand } from './cli/hetzner/recover.command.ts'
import { planCommand } from './cli/pipeline/plan.command.ts'
import { prodGateCommand } from './cli/pipeline/prod-gate.command.ts'
import { publishResultCommand } from './cli/pipeline/publish-result.command.ts'
import { loadConfig } from './config/load.ts'
import type { DeployableConfig, NextNodeConfig } from './config/types.ts'
import { isDeployableConfig } from './config/types.ts'

const logger = createLogger()

type ConfigCommand = (config: NextNodeConfig) => void | Promise<void>
type DeployCommand = (config: DeployableConfig) => void | Promise<void>
type StandaloneCommand = () => void | Promise<void>

const PLAN_COMMANDS: Record<string, ConfigCommand> = {
	plan: planCommand,
	'teardown-guard': teardownGuardCommand,
}

const DEPLOY_COMMANDS: Record<string, DeployCommand> = {
	provision: provisionCommand,
	deploy: deployCommand,
	dns: dnsCommand,
	teardown: teardownCommand,
	'seo-guard': seoGuardCommand,
}

const STANDALONE_COMMANDS: Record<string, StandaloneCommand> = {
	'prod-gate': prodGateCommand,
	'publish-result': publishResultCommand,
	'compute-image-ref': computeImageRefCommand,
	'build-golden-image': buildGoldenImageCommand,
	recover: recoverCommand,
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
