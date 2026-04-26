import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { getEnv, requireEnv } from '@/cli/env.ts'
import { loadR2Runtime } from '@/cli/r2/load-runtime.ts'
import type { DeployableConfig } from '@/config/types.ts'
import { isHetznerDeployableConfig } from '@/config/types.ts'
import { resolveEnvironment } from '@/domain/environment.ts'

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
	const infraR2 = isHetznerDeployableConfig(config)
		? await loadR2Runtime(requireEnv('CLOUDFLARE_API_TOKEN'))
		: null
	const target = buildRuntimeTarget(config, environment, infraR2)
	await target.reconcileDns(config.project.name, config.project.domain)
}
