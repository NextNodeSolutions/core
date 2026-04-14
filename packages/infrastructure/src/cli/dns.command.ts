import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { reconcileDns } from '../adapters/cloudflare/pages-dns.ts'
import type { DeployableConfig } from '../config/types.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'

import { getEnv, requireEnv } from './env.ts'

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
	const token = requireEnv('CLOUDFLARE_API_TOKEN')
	const pagesProjectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	await reconcileDns({
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		pagesProjectName,
		token,
		domain: config.project.domain,
		redirectDomains: config.project.redirectDomains,
		environment,
	})

	logger.info('DNS reconciliation complete')
}
