import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { getEnv } from '#/cli/env.ts'
import type { DeployableConfig } from '#/config/types.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'

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
	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)
	await target.reconcileDns(config.project.name, config.project.domain)
}
