import { logger } from '@nextnode-solutions/logger'

import {
	createPagesProject,
	getPagesProject,
} from '../adapters/cloudflare-pages.js'
import { loadConfig } from '../config/load.js'

import { requireEnv } from './env.js'

const PRODUCTION_BRANCH = 'main'

export async function ensurePagesProjectCommand(): Promise<void> {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)
	const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
	const token = requireEnv('CLOUDFLARE_API_TOKEN')

	const projectName = config.project.name
	const existing = await getPagesProject(accountId, projectName, token)

	if (existing) {
		logger.info(
			`Cloudflare Pages project "${projectName}" already exists (production_branch=${existing.productionBranch})`,
		)
		return
	}

	logger.info(
		`Cloudflare Pages project "${projectName}" not found, creating with production_branch=${PRODUCTION_BRANCH}`,
	)
	const created = await createPagesProject(
		accountId,
		projectName,
		PRODUCTION_BRANCH,
		token,
	)
	logger.info(
		`Cloudflare Pages project "${created.name}" created successfully`,
	)
}
