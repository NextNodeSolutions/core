import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { computeDnsRecords } from '../../domain/cloudflare/dns-records.ts'
import { computePagesProjectName } from '../../domain/cloudflare/pages-project-name.ts'
import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	ProvisionResult,
	StaticDeployedEnvironment,
} from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'

import { reconcileDomains } from './pages-domains.ts'
import { updatePagesEnvVars } from './pages-env.ts'
import { provisionProject } from './pages-project.ts'
import { getPagesProject } from './pages.ts'
import { reconcileDnsRecords } from './reconcile-dns.ts'

export interface CloudflarePagesTargetConfig {
	readonly environment: AppEnvironment
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
}

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} env var is required`)
	}
	return value
}

export class CloudflarePagesTarget implements DeployTarget {
	readonly name = 'cloudflare-pages'
	private readonly accountId: string
	private readonly token: string
	private readonly environment: AppEnvironment
	private readonly domain: string | undefined
	private readonly redirectDomains: ReadonlyArray<string>

	constructor(config: CloudflarePagesTargetConfig) {
		this.accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID')
		this.token = requireEnv('CLOUDFLARE_API_TOKEN')
		this.environment = config.environment
		this.domain = config.domain
		this.redirectDomains = config.redirectDomains
	}

	async computeDeployEnv(projectName: string): Promise<DeployEnv> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)
		return { SITE_URL: await this.resolveSiteUrl(pagesProjectName) }
	}

	async ensureInfra(projectName: string): Promise<ProvisionResult> {
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.environment,
		)

		await provisionProject(this.accountId, pagesProjectName, this.token)

		if (this.domain) {
			await reconcileDomains({
				accountId: this.accountId,
				pagesProjectName,
				token: this.token,
				domain: this.domain,
				redirectDomains: this.redirectDomains,
				environment: this.environment,
			})
		}

		logger.info(
			`Infrastructure ready for "${pagesProjectName}" (${this.environment})`,
		)

		return {
			kind: 'static',
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
