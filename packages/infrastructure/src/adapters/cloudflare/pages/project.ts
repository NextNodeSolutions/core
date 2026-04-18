import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '../../../domain/deploy/target.ts'

import { createPagesProject, getPagesProject } from './api.ts'

const logger = createLogger()

const PRODUCTION_BRANCH = 'main'

export async function provisionProject(
	accountId: string,
	pagesProjectName: string,
	token: string,
): Promise<ResourceOutcome> {
	const existing = await getPagesProject(accountId, pagesProjectName, token)
	if (existing) {
		logger.info(`Pages project "${pagesProjectName}" already exists`)
		return { handled: false, detail: `existing "${pagesProjectName}"` }
	}

	logger.info(`Creating Pages project "${pagesProjectName}"`)
	await createPagesProject(
		accountId,
		pagesProjectName,
		PRODUCTION_BRANCH,
		token,
	)
	logger.info(`Pages project "${pagesProjectName}" created`)
	return { handled: true, detail: `created "${pagesProjectName}"` }
}
