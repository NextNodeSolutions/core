import {
	computePagesDomains,
	findStalePagesDomains,
	reconcilePagesDomain,
} from '#/domain/cloudflare/pages-domains.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { attachPagesDomain, listPagesDomains } from './api.ts'

import type { DesiredPagesDomain } from '#/domain/cloudflare/pages-domains.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { CloudflarePagesDomain } from './api.ts'

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
): Promise<ResourceOutcome> {
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

	const target: PagesProjectTarget = {
		accountId: input.accountId,
		pagesProjectName: input.pagesProjectName,
		token: input.token,
	}
	await Promise.all(desired.map(d => applyDomain(target, d, attached)))

	const stale = findStalePagesDomains(desired, attached)
	if (stale.length > 0) {
		logger.warn(
			`${stale.length} attached domain(s) not in config: ${stale.map(s => s.name).join(', ')}`,
		)
	}

	return {
		handled: true,
		detail: `reconciled for "${input.domain}"`,
	}
}

interface PagesProjectTarget {
	readonly accountId: string
	readonly pagesProjectName: string
	readonly token: string
}

async function applyDomain(
	target: PagesProjectTarget,
	desired: DesiredPagesDomain,
	attached: ReadonlyArray<CloudflarePagesDomain>,
): Promise<void> {
	const action = reconcilePagesDomain(desired, attached)
	if (action.kind === 'skip') {
		logger.info(`Domain "${desired.name}" already attached`)
		return
	}
	await attachPagesDomain(
		target.accountId,
		target.pagesProjectName,
		desired.name,
		target.token,
	)
	logger.info(`Attached domain "${desired.name}"`)
}
