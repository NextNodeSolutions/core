import { createLogger } from '@nextnode-solutions/logger'

import { createPagesProject, getPagesProject } from './pages.ts'

const logger = createLogger()

const PRODUCTION_BRANCH = 'main'

export async function provisionProject(
	accountId: string,
	pagesProjectName: string,
	token: string,
): Promise<void> {
	const existing = await getPagesProject(accountId, pagesProjectName, token)
	if (existing) {
		logger.info(`Pages project "${pagesProjectName}" already exists`)
		return
	}

	logger.info(`Creating Pages project "${pagesProjectName}"`)
	await createPagesProject(
		accountId,
		pagesProjectName,
		PRODUCTION_BRANCH,
		token,
	)
	logger.info(`Pages project "${pagesProjectName}" created`)
}
