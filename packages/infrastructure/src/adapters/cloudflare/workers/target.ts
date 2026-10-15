import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { migratePlanetscale } from '#/adapters/planetscale/migrate.ts'
import { defaultTerraformRunner } from '#/adapters/terraform/runner.ts'
import {
	EMPTY_WORKERS_TERRAFORM_OUTPUTS,
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	hasWorkersBacking,
} from '#/domain/cloudflare/workers/outputs-env.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import { deployWorkers } from './deploy-workers.ts'
import { migrateWorkers } from './migrate-workers.ts'
import { teardownWorkers } from './teardown-workers.ts'
import {
	memoizeOutputsReader,
	planWorkersTerraform,
	readWorkersTerraformOutputs,
} from './terraform-ops.ts'
import { runWorkersProvision } from './workers-provision.ts'

import type { TerraformRunner } from '#/adapters/terraform/runner.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { OrganizationConfig } from '#/config/organization.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	MigrateInput,
	MigrateResult,
	ProvisionResult,
	TargetEnv,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import type { OutputsReader, WorkersTerraformContext } from './terraform-ops.ts'

export interface CloudflareWorkersTargetConfig {
	readonly organization: OrganizationConfig
	readonly accountId: string
	readonly hcpToken: string
	readonly planetscaleServiceTokenId?: string
	readonly planetscaleServiceToken?: string
	readonly environment: AppEnvironment
	readonly config: CloudflareWorkersDeployableConfig
	readonly projectDir?: string
	readonly terraformRunner?: TerraformRunner
	readonly wranglerRunner?: WranglerRunner
}

export class CloudflareWorkersTarget implements DeployTarget {
	readonly name = 'cloudflare-workers'
	private readonly organization: OrganizationConfig
	private readonly accountId: string
	private readonly hcpToken: string
	private readonly planetscaleServiceTokenId: string | undefined
	private readonly planetscaleServiceToken: string | undefined
	private readonly environment: AppEnvironment
	private readonly config: CloudflareWorkersDeployableConfig
	private readonly projectDir: string | undefined
	private readonly runner: TerraformRunner
	private readonly wrangler: WranglerRunner | undefined
	private readonly loadTerraformOutputs: OutputsReader

	constructor(config: CloudflareWorkersTargetConfig) {
		this.organization = config.organization
		this.accountId = config.accountId
		this.hcpToken = config.hcpToken
		this.planetscaleServiceTokenId = config.planetscaleServiceTokenId
		this.planetscaleServiceToken = config.planetscaleServiceToken
		this.environment = config.environment
		this.config = config.config
		this.projectDir = config.projectDir
		this.runner = config.terraformRunner ?? defaultTerraformRunner
		this.wrangler = config.wranglerRunner
		this.loadTerraformOutputs = memoizeOutputsReader(() =>
			hasWorkersBacking(deriveWorkersBackingConfig(this.config.services))
				? readWorkersTerraformOutputs(this.terraformContext())
				: Promise.resolve(EMPTY_WORKERS_TERRAFORM_OUTPUTS),
		)
	}

	contributeEnv(projectName: string): TargetEnv {
		void projectName
		return {
			public: {
				SITE_URL: computeSiteUrl(
					this.config.project.domain,
					this.environment,
				),
			},
			secret: {},
		}
	}

	async ensureInfra(projectName: string): Promise<ProvisionResult> {
		const start = Date.now()
		const workspaceName = `${projectName}-${this.environment}`

		const outcome = await runWorkersProvision({
			organization: this.organization,
			workspaceName,
			projectName,
			hcpToken: this.hcpToken,
			config: this.config,
			environment: this.environment,
			planetscaleServiceTokenId: this.planetscaleServiceTokenId,
			planetscaleServiceToken: this.planetscaleServiceToken,
			terraformContext: this.terraformContext(),
		})

		logger.info(
			`Infrastructure ready for "${workspaceName}" (${this.environment})`,
		)

		return {
			kind: 'workers',
			outcome,
			workspaceName,
			durationMs: Date.now() - start,
		}
	}

	async loadBackingEnv(projectName: string): Promise<ServiceEnv> {
		void projectName
		const backing = deriveWorkersBackingConfig(this.config.services)
		if (!hasWorkersBacking(backing)) {
			return { public: {}, secret: {} }
		}
		const outputs = await this.loadTerraformOutputs()
		return buildWorkersBackingEnv(outputs, this.accountId, backing)
	}

	async deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		void env
		const outputs = await this.loadTerraformOutputs()
		return deployWorkers({
			projectName,
			environment: this.environment,
			domain: this.config.project.domain,
			isInternal: this.config.project.internal,
			services: this.config.deploy.services,
			backingServices: this.config.services,
			cron: this.config.deploy.cron,
			outputs,
			secrets: input.secrets,
			accountId: this.accountId,
			wranglerRunner: this.wrangler,
			projectDir: this.requireProjectDir(),
		})
	}

	private requireProjectDir(): string {
		if (typeof this.projectDir === 'undefined') {
			throw new Error(
				`${this.name} deploy needs the project directory (where the built bundle lives) but none was resolved - PIPELINE_CONFIG_FILE must point at the app's nextnode.toml.`,
			)
		}
		return this.projectDir
	}

	private terraformContext(): WorkersTerraformContext {
		return {
			config: this.config,
			organization: this.organization,
			environment: this.environment,
			runner: this.runner,
			accountId: this.accountId,
		}
	}

	async runMigrate(input: MigrateInput): Promise<MigrateResult> {
		const outputs = await this.loadTerraformOutputs()
		if (input.kind === 'planetscale') {
			return migratePlanetscale(
				outputs.planetscaleMigrator,
				input.migrateCommand,
				this.requireProjectDir(),
			)
		}
		return migrateWorkers({
			projectName: input.projectName,
			environment: this.environment,
			services: this.config.deploy.services,
			backingServices: this.config.services,
			cron: this.config.deploy.cron,
			outputs,
			wranglerRunner: this.wrangler,
			projectDir: this.requireProjectDir(),
		})
	}

	teardown(projectName: string): Promise<TeardownResult> {
		return teardownWorkers({
			projectName,
			environment: this.environment,
			serviceNames: Object.keys(this.config.deploy.services),
			wranglerRunner: this.wrangler,
			terraformContext: this.terraformContext(),
		})
	}
	planDiff(): Promise<string> {
		return planWorkersTerraform(this.terraformContext())
	}
}
