import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { computeDnsRecords } from '#/domain/cloudflare/dns-records.ts'
import { PAGES_MANAGED_RESOURCES } from '#/domain/cloudflare/managed-resources.ts'
import { computePagesProjectName } from '#/domain/cloudflare/pages-project-name.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'

import { reconcileDnsRecords } from './dns/reconcile.ts'
import { getPagesProject } from './pages/api.ts'
import { reconcileDomains } from './pages/domains.ts'
import { updatePagesEnvVars } from './pages/env.ts'
import { provisionProject } from './pages/project.ts'
import { teardownPagesDns, teardownProject } from './teardown-pages.ts'

import type {
	AutoRestoreInput,
	AutoRestoreResult,
} from '#/domain/deploy/auto-restore.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	MigrateInput,
	MigrateResult,
	ProvisionResult,
	SnapshotInput,
	SnapshotResult,
	StaticDeployedEnvironment,
	TargetEnv,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

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
			{
				accountId: this.accountId,
				projectName: pagesProjectName,
				token: this.token,
			},
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

	prepareRollout(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<void> {
		void projectName
		void input
		void env
		throw new Error(
			`prepareRollout is not applicable to ${this.name}: Cloudflare Pages has no database to stage before migrate. Configure a container-based target if your app needs a postgres migration step.`,
		)
	}

	runMigrate(input: MigrateInput): Promise<MigrateResult> {
		void input
		throw new Error(
			`runMigrate is not applicable to ${this.name}: schema migrations require a runtime database, which Cloudflare Pages does not host. Configure a container-based target if your app needs a postgres migration step.`,
		)
	}

	runPreMigrateSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
		void input
		throw new Error(
			`runPreMigrateSnapshot is not applicable to ${this.name}: there is no embedded postgres sidecar to snapshot. Configure a container-based target if your app needs a postgres backup step.`,
		)
	}

	runAutoRestore(input: AutoRestoreInput): Promise<AutoRestoreResult> {
		void input
		throw new Error(
			`runAutoRestore is not applicable to ${this.name}: there is no embedded postgres to rehydrate. Configure a container-based target if your app needs auto-restore.`,
		)
	}

	runFinalBackup(input: SnapshotInput): Promise<SnapshotResult> {
		void input
		throw new Error(
			`runFinalBackup is not applicable to ${this.name}: there is no embedded postgres to back up before teardown.`,
		)
	}

	async teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		shouldWipeVolumes: boolean,
	): Promise<TeardownResult> {
		void target
		void shouldWipeVolumes
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
			return computeSiteUrl(this.domain, this.environment)
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
				`Pages project "${pagesProjectName}" not found - run provision first`,
			)
		}
		return project.subdomain
	}
}
