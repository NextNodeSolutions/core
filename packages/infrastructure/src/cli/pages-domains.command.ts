import { logger } from '@nextnode-solutions/logger'

import {
	attachPagesDomain,
	listPagesDomains,
} from '../adapters/cloudflare-pages.ts'
import type { CloudflarePagesDomain } from '../adapters/cloudflare-pages.ts'
import { loadConfig } from '../config/load.ts'
import type { ProjectSection } from '../config/schema.ts'
import type { AppEnvironment } from '../domain/environment.ts'
import { resolveEnvironment } from '../domain/environment.ts'
import type { DesiredPagesDomain } from '../domain/pages-domains.ts'
import {
	computePagesDomains,
	findStalePagesDomains,
	reconcilePagesDomain,
} from '../domain/pages-domains.ts'
import { computePagesProjectName } from '../domain/pages-project-name.ts'

import { getEnv, requireEnv } from './env.ts'

export async function ensurePagesDomainsCommand(): Promise<void> {
	const configPath = requireEnv('PIPELINE_CONFIG_FILE')
	const config = loadConfig(configPath)

	if (!config.project.domain) {
		logger.info(
			'No project.domain configured in nextnode.toml — skipping Pages custom domains attach',
		)
		return
	}

	const environment = resolveAppEnvironmentForPagesDomains(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
	const token = requireEnv('CLOUDFLARE_API_TOKEN')

	const projectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	const desired = computePagesDomains({
		domain: config.project.domain,
		redirectDomains: config.project.redirectDomains,
		environment,
	})

	logger.info(
		`Ensuring ${desired.length} Pages custom domain(s) on "${projectName}" (${environment})`,
	)

	const attached = await listPagesDomains(accountId, projectName, token)

	await Promise.all(
		desired.map(domain =>
			applyDomain(accountId, projectName, domain, attached, token),
		),
	)

	reportStaleDomains(desired, attached)

	logger.info('Pages custom domains attach complete')
}

async function applyDomain(
	accountId: string,
	projectName: string,
	desired: DesiredPagesDomain,
	attached: ReadonlyArray<CloudflarePagesDomain>,
	token: string,
): Promise<void> {
	const action = reconcilePagesDomain(desired, attached)

	if (action.kind === 'skip') {
		logger.info(`Skip: ${desired.name} already attached`)
		return
	}
	await attachPagesDomain(accountId, projectName, desired.name, token)
	logger.info(`Attached: ${desired.name}`)
}

function reportStaleDomains(
	desired: ReadonlyArray<DesiredPagesDomain>,
	attached: ReadonlyArray<CloudflarePagesDomain>,
): void {
	const stale = findStalePagesDomains(desired, attached)
	if (stale.length === 0) return
	logger.warn(
		`${stale.length} attached domain(s) not in nextnode.toml (left untouched): ${stale.map(item => item.name).join(', ')}`,
	)
}

function resolveAppEnvironmentForPagesDomains(
	projectType: ProjectSection['type'],
	rawEnv: string | undefined,
): AppEnvironment {
	const resolved = resolveEnvironment(projectType, rawEnv)
	if (resolved === 'none') {
		throw new Error(
			'Pages custom domains are not supported for package projects',
		)
	}
	return resolved
}
