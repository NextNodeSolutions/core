import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import type { DeployableConfig } from '../../config/types.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv } from '../env.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'

export async function dnsCommand(config: DeployableConfig): Promise<void> {
	if (!config.project.domain) {
		logger.info(
			'No project.domain configured — skipping DNS reconciliation',
		)
		return
	}

	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = await buildRuntimeTarget(config, environment)
	await target.reconcileDns(config.project.name, config.project.domain)
}
