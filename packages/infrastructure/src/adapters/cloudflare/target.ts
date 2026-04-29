import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { computeDnsRecords } from '#/domain/cloudflare/dns-records.ts'
import { PAGES_MANAGED_RESOURCES } from '#/domain/cloudflare/managed-resources.ts'
import { computePagesProjectName } from '#/domain/cloudflare/pages-project-name.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	ProvisionResult,
	StaticDeployedEnvironment,
	TargetEnv,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import { reconcileDnsRecords } from './dns/reconcile.ts'
import { getPagesProject } from './pages/api.ts'
import { reconcileDomains } from './pages/domains.ts'
import { updatePagesEnvVars } from './pages/env.ts'
import { provisionProject } from './pages/project.ts'
import { teardownPagesDns, teardownProject } from './teardown-pages.ts'

export interface CloudflarePagesTargetConfig {
	readonly accountId: string
	readonly token: string
	readonly environment: AppEnvironment
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
}

export class CloudflarePagesTarget implements DeployTarget {
	readonly name = 'cloudflare-pages'
	private readonly accountId: string
	private readonly token: string
	private readonly environment: AppEnvironment
	private readonly domain: string | undefined
	private readonly redirectDomains: ReadonlyArray<string>

	constructor(config: CloudflarePagesTargetConfig) {
		this.accountId = config.accountId
		this.token = config.token
		this.environment = config.environment
		this.domain = config.domain
		this.redirectDomains = config.redirectDomains
	}

	async contributeEnv(projectName: string): Promise<TargetEnv> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)
		return {
			public: { SITE_URL: await this.resolveSiteUrl(pagesProjectName) },
			secret: {},
		}
	}

	async ensureInfra(projectName: string): Promise<ProvisionResult> {
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)

		const outcome = await executeHandlers(PAGES_MANAGED_RESOURCES, {
			'pages-project': () =>
				provisionProject(this.accountId, pagesProjectName, this.token),
			dns: () => {
				if (!this.domain) {
					return { handled: false, detail: 'no domain configured' }
				}
				return reconcileDomains({
					accountId: this.accountId,
					pagesProjectName,
					token: this.token,
					domain: this.domain,
					redirectDomains: this.redirectDomains,
					environment: this.environment,
				})
			},
		})

		logger.info(
			`Infrastructure ready for "${pagesProjectName}" (${this.environment})`,
		)

		return {
			kind: 'static',
			outcome,
			pagesProjectName,
			durationMs: Date.now() - start,
		}
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)

		const subdomain = await this.fetchSubdomain(pagesProjectName)

		const records = computeDnsRecords({
			domain,
			redirectDomains: this.redirectDomains,
			environment: this.environment,
			pagesSubdomain: subdomain,
		})

		await reconcileDnsRecords(records, this.token)
		logger.info('DNS reconciliation complete')
	}

	async deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)

		logger.info(`Syncing env vars to "${pagesProjectName}"`)
		await updatePagesEnvVars(
			this.accountId,
			pagesProjectName,
			this.token,
			env,
			input.secrets,
		)

		const deployed: StaticDeployedEnvironment = {
			kind: 'static',
			name: this.environment,
			url: env.SITE_URL,
			deployedAt: new Date(),
		}

		logger.info(`Env vars synced to "${pagesProjectName}"`)

		return {
			projectName,
			deployedEnvironments: [deployed],
			durationMs: Date.now() - start,
		}
	}

	async teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		withVolumes: boolean,
	): Promise<TeardownResult> {
		if (target !== 'project') {
			throw new Error(
				`TEARDOWN_TARGET="${target}" is not supported for Cloudflare Pages projects — only "project" scope exists`,
			)
		}
		if (withVolumes) {
			throw new Error(
				'TEARDOWN_WITH_VOLUMES=true is not supported for Cloudflare Pages projects — static deploys have no volumes',
			)
		}
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)

		const outcome = await executeHandlers(PAGES_MANAGED_RESOURCES, {
			'pages-project': () =>
				teardownProject(this.accountId, pagesProjectName, this.token),
			dns: () =>
				teardownPagesDns(
					domain,
					this.redirectDomains,
					this.environment,
					this.token,
				),
		})

		logger.info(`Teardown complete for "${projectName}"`)

		return {
			kind: 'static',
			scope: 'project',
			pagesProjectName,
			outcome,
			durationMs: Date.now() - start,
		}
	}

	private async resolveSiteUrl(pagesProjectName: string): Promise<string> {
		if (this.domain) {
			return `https://${resolveDeployDomain(this.domain, this.environment)}`
		}
		const subdomain = await this.fetchSubdomain(pagesProjectName)
		return `https://${subdomain}`
	}

	private async fetchSubdomain(pagesProjectName: string): Promise<string> {
		const project = await getPagesProject(
			this.accountId,
			pagesProjectName,
			this.token,
		)
		if (!project) {
			throw new Error(
				`Pages project "${pagesProjectName}" not found — run provision first`,
			)
		}
		return project.subdomain
	}
}
