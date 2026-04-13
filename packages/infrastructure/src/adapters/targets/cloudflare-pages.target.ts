import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import type {
	DeployResult,
	DeployTarget,
	StaticDeployConfig,
	StaticDeployedEnvironment,
	TargetState,
} from '../../domain/deploy-target.ts'
import type { DesiredDnsRecord } from '../../domain/dns-records.ts'
import {
	computeDnsRecords,
	reconcileDnsRecord,
} from '../../domain/dns-records.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import type { DesiredPagesDomain } from '../../domain/pages-domains.ts'
import {
	computePagesDomains,
	findStalePagesDomains,
	reconcilePagesDomain,
} from '../../domain/pages-domains.ts'
import { computePagesProjectName } from '../../domain/pages-project-name.ts'
import {
	createDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from '../cloudflare-dns.ts'
import { updatePagesEnvVars } from '../cloudflare-pages-env.ts'
import {
	attachPagesDomain,
	createPagesProject,
	getPagesProject,
	listPagesDomains,
} from '../cloudflare-pages.ts'
import type { CloudflarePagesDomain } from '../cloudflare-pages.ts'

const PRODUCTION_BRANCH = 'main'

export interface CloudflarePagesTargetDeps {
	readonly accountId: string
	readonly token: string
	readonly environment: AppEnvironment
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
}

export class CloudflarePagesTarget implements DeployTarget<StaticDeployConfig> {
	readonly name = 'cloudflare-pages'

	constructor(private readonly deps: CloudflarePagesTargetDeps) {}

	async ensureInfra(projectName: string): Promise<void> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.deps.environment,
		)

		await this.ensureProject(pagesProjectName)

		if (this.deps.domain) {
			await this.ensureDomains(pagesProjectName)
			await this.ensureDns(pagesProjectName)
		}

		logger.info(
			`Infrastructure ready for "${pagesProjectName}" (${this.deps.environment})`,
		)
	}

	async deploy(config: StaticDeployConfig): Promise<DeployResult> {
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			config.projectName,
			this.deps.environment,
		)

		const env = config.environments[0]
		if (!env) {
			throw new Error('deploy requires at least one environment config')
		}

		logger.info(`Syncing env vars to "${pagesProjectName}"`)
		await updatePagesEnvVars(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
			env.envVars,
			env.secrets,
		)

		const deployed: StaticDeployedEnvironment = {
			kind: 'static',
			name: env.name,
			url: `https://${env.hostname}`,
			deployedAt: new Date(),
		}

		logger.info(`Env vars synced to "${pagesProjectName}"`)

		return {
			projectName: config.projectName,
			deployedEnvironments: [deployed],
			durationMs: Date.now() - start,
		}
	}

	async describe(projectName: string): Promise<TargetState | null> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.deps.environment,
		)
		const project = await getPagesProject(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
		)
		if (!project) return null

		return { projectName: project.name, environments: [] }
	}

	private async ensureProject(pagesProjectName: string): Promise<void> {
		const existing = await getPagesProject(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
		)
		if (existing) {
			logger.info(`Pages project "${pagesProjectName}" already exists`)
			return
		}

		logger.info(`Creating Pages project "${pagesProjectName}"`)
		await createPagesProject(
			this.deps.accountId,
			pagesProjectName,
			PRODUCTION_BRANCH,
			this.deps.token,
		)
		logger.info(`Pages project "${pagesProjectName}" created`)
	}

	private async ensureDomains(pagesProjectName: string): Promise<void> {
		const desired = computePagesDomains({
			domain: this.deps.domain!,
			redirectDomains: this.deps.redirectDomains,
			environment: this.deps.environment,
		})

		const attached = await listPagesDomains(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
		)

		await Promise.all(
			desired.map(d => this.applyDomain(pagesProjectName, d, attached)),
		)

		const stale = findStalePagesDomains(desired, attached)
		if (stale.length > 0) {
			logger.warn(
				`${stale.length} attached domain(s) not in config: ${stale.map(s => s.name).join(', ')}`,
			)
		}
	}

	private async applyDomain(
		pagesProjectName: string,
		desired: DesiredPagesDomain,
		attached: ReadonlyArray<CloudflarePagesDomain>,
	): Promise<void> {
		const action = reconcilePagesDomain(desired, attached)
		if (action.kind === 'skip') {
			logger.info(`Domain "${desired.name}" already attached`)
			return
		}
		await attachPagesDomain(
			this.deps.accountId,
			pagesProjectName,
			desired.name,
			this.deps.token,
		)
		logger.info(`Attached domain "${desired.name}"`)
	}

	private async ensureDns(pagesProjectName: string): Promise<void> {
		const records = computeDnsRecords({
			domain: this.deps.domain!,
			redirectDomains: this.deps.redirectDomains,
			environment: this.deps.environment,
			projectName: pagesProjectName,
		})

		const zoneIds = await this.resolveAllZoneIds(records)

		await Promise.all(
			records.map(desired => {
				const zoneId = zoneIds.get(desired.zoneName)
				if (!zoneId) {
					throw new Error(
						`Zone ID not resolved for ${desired.zoneName}`,
					)
				}
				return this.applyDnsRecord(zoneId, desired)
			}),
		)
	}

	private async resolveAllZoneIds(
		records: ReadonlyArray<DesiredDnsRecord>,
	): Promise<Map<string, string>> {
		const uniqueZones = [...new Set(records.map(r => r.zoneName))]
		const entries = await Promise.all(
			uniqueZones.map(
				async (zone): Promise<[string, string]> => [
					zone,
					await lookupZoneId(zone, this.deps.token),
				],
			),
		)
		return new Map(entries)
	}

	private async applyDnsRecord(
		zoneId: string,
		desired: DesiredDnsRecord,
	): Promise<void> {
		const existing = await listDnsRecords(
			zoneId,
			desired.name,
			desired.type,
			this.deps.token,
		)

		const action = reconcileDnsRecord(desired, existing)
		const proxiedLabel = desired.proxied ? 'proxied' : 'unproxied'

		if (action.kind === 'skip') {
			logger.info(
				`DNS "${desired.name}" already correct (${proxiedLabel})`,
			)
			return
		}
		if (action.kind === 'create') {
			await createDnsRecord(zoneId, desired, this.deps.token)
			logger.info(`DNS created: ${desired.name} (${proxiedLabel})`)
			return
		}
		await updateDnsRecord(zoneId, action.recordId, desired, this.deps.token)
		logger.info(`DNS updated: ${desired.name} (${proxiedLabel})`)
	}
}
