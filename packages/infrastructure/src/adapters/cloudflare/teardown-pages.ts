import { createLogger } from '@nextnode-solutions/logger'

import { computePagesDnsLookups } from '@/domain/cloudflare/dns-records.ts'
import type { ResourceOutcome } from '@/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '@/domain/environment.ts'

import { deleteDnsRecordsByName } from './dns/delete-records.ts'
import { deletePagesProject } from './pages/api.ts'

const logger = createLogger()

export async function teardownProject(
	accountId: string,
	pagesProjectName: string,
	token: string,
): Promise<ResourceOutcome> {
	const deleted = await deletePagesProject(accountId, pagesProjectName, token)
	if (!deleted) {
		logger.info(`Pages project "${pagesProjectName}" already gone`)
		return { handled: false, detail: 'already gone' }
	}

	logger.info(`Pages project "${pagesProjectName}" deleted`)
	return { handled: true, detail: 'deleted' }
}

export async function teardownPagesDns(
	domain: string | undefined,
	redirectDomains: ReadonlyArray<string>,
	environment: AppEnvironment,
	token: string,
): Promise<ResourceOutcome> {
	if (!domain) {
		return { handled: false, detail: 'no domain configured' }
	}

	const lookups = computePagesDnsLookups({
		domain,
		redirectDomains,
		environment,
	})
	const deletedCount = await deleteDnsRecordsByName(lookups, token)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} record(s) deleted`,
	}
}
