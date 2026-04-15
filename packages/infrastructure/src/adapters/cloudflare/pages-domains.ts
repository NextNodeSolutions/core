import { createLogger } from '@nextnode-solutions/logger'

import type { DesiredPagesDomain } from '../../domain/cloudflare/pages-domains.ts'
import {
	computePagesDomains,
	findStalePagesDomains,
	reconcilePagesDomain,
} from '../../domain/cloudflare/pages-domains.ts'
import type { AppEnvironment } from '../../domain/environment.ts'

import type { CloudflarePagesDomain } from './pages.ts'
import { attachPagesDomain, listPagesDomains } from './pages.ts'

const logger = createLogger()

export interface ReconcileDomainsInput {
	readonly accountId: string
	readonly pagesProjectName: string
	readonly token: string
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
}

export async function reconcileDomains(
	input: ReconcileDomainsInput,
): Promise<void> {
	const desired = computePagesDomains({
		domain: input.domain,
		redirectDomains: input.redirectDomains,
		environment: input.environment,
	})

	const attached = await listPagesDomains(
		input.accountId,
		input.pagesProjectName,
		input.token,
	)

	await Promise.all(
		desired.map(d =>
			applyDomain(
				input.accountId,
				input.pagesProjectName,
				d,
				attached,
				input.token,
			),
		),
	)

	const stale = findStalePagesDomains(desired, attached)
	if (stale.length > 0) {
		logger.warn(
			`${stale.length} attached domain(s) not in config: ${stale.map(s => s.name).join(', ')}`,
		)
	}
}

async function applyDomain(
	accountId: string,
	pagesProjectName: string,
	desired: DesiredPagesDomain,
	attached: ReadonlyArray<CloudflarePagesDomain>,
	token: string,
): Promise<void> {
	const action = reconcilePagesDomain(desired, attached)
	if (action.kind === 'skip') {
		logger.info(`Domain "${desired.name}" already attached`)
		return
	}
	await attachPagesDomain(accountId, pagesProjectName, desired.name, token)
	logger.info(`Attached domain "${desired.name}"`)
}
