import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { ensureHcpWorkspace } from '#/adapters/hcp/workspaces.ts'
import {
	defaultTerraformRunner,
	terraformApply,
	terraformInit,
	terraformOutputJson,
	writeTerraformConfig,
} from '#/adapters/terraform/runner.ts'
import { WORKERS_MANAGED_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import {
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	hasWorkersBacking,
	parseTerraformOutputs,
} from '#/domain/cloudflare/workers/outputs-env.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import {
	buildTerraformMainConfig,
	HCP_TERRAFORM_ORGANIZATION,
} from '#/domain/deploy/terraform-config.ts'

import type { TerraformRunner } from '#/adapters/terraform/runner.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type {
	AutoRestoreInput,
	AutoRestoreResult,
} from '#/domain/deploy/auto-restore.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
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
	TargetEnv,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

export interface CloudflareWorkersTargetConfig {
	readonly accountId: string
	readonly hcpToken: string
	readonly environment: AppEnvironment
	readonly config: CloudflareWorkersDeployableConfig
	// Injection point for tests; production shells out to the `terraform` binary.
	readonly terraformRunner?: TerraformRunner
}

const WORKDIR_PREFIX = 'nn-workers-tf-'

export class CloudflareWorkersTarget implements DeployTarget {
	readonly name = 'cloudflare-workers'
	private readonly accountId: string
	private readonly hcpToken: string
	private readonly environment: AppEnvironment
	private readonly config: CloudflareWorkersDeployableConfig
	private readonly runner: TerraformRunner

	constructor(config: CloudflareWorkersTargetConfig) {
		this.accountId = config.accountId
		this.hcpToken = config.hcpToken
		this.environment = config.environment
		this.config = config.config
		this.runner = config.terraformRunner ?? defaultTerraformRunner
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

		const outcome = await executeHandlers(WORKERS_MANAGED_RESOURCES, {
			'hcp-workspace': () =>
				ensureHcpWorkspace({
					organization: HCP_TERRAFORM_ORGANIZATION,
					workspaceName,
					token: this.hcpToken,
				}),
			terraform: () => this.applyTerraform(),
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

		return this.withTerraformWorkdir(async workdir => {
			await terraformInit(workdir, this.runner)
			const raw = await terraformOutputJson(workdir, this.runner)
			return buildWorkersBackingEnv(
				parseTerraformOutputs(raw),
				this.accountId,
				backing,
			)
		})
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		void projectName
		void domain
		logger.info(
			`reconcileDns is a no-op for ${this.name}: apex/redirect DNS is provisioned by Terraform (Redirect Rules + support records) and Worker custom domains are attached by wrangler at deploy - nothing to reconcile here.`,
		)
	}

	deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		void projectName
		void input
		void env
		throw new Error(
			`deploy is not wired yet for ${this.name}: the wrangler deploy implementation lands in US-3.1.`,
		)
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
			`prepareRollout is not applicable to ${this.name}: there is no database to stage before migrate. D1 migrations run via \`wrangler d1 migrations apply\` with no rollout staging.`,
		)
	}

	runMigrate(input: MigrateInput): Promise<MigrateResult> {
		void input
		throw new Error(
			`runMigrate is not wired yet for ${this.name}: D1 migrations (\`wrangler d1 migrations apply\`) land in US-3.3.`,
		)
	}

	runPreMigrateSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
		void input
		throw new Error(
			`runPreMigrateSnapshot is not applicable to ${this.name}: D1 has no VPS-style backup sidecar to snapshot.`,
		)
	}

	runAutoRestore(input: AutoRestoreInput): Promise<AutoRestoreResult> {
		void input
		throw new Error(
			`runAutoRestore is not applicable to ${this.name}: D1 has no embedded database to rehydrate.`,
		)
	}

	runFinalBackup(input: SnapshotInput): Promise<SnapshotResult> {
		void input
		throw new Error(
			`runFinalBackup is not applicable to ${this.name}: D1 has no VPS-style backup path to capture before teardown.`,
		)
	}

	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		shouldWipeVolumes: boolean,
	): Promise<TeardownResult> {
		void projectName
		void domain
		void target
		void shouldWipeVolumes
		throw new Error(
			`teardown is not wired yet for ${this.name}: the Terraform destroy + wrangler delete implementation lands in US-2.4.`,
		)
	}

	private async applyTerraform(): Promise<ResourceOutcome> {
		await this.withTerraformWorkdir(async workdir => {
			await terraformInit(workdir, this.runner)
			await terraformApply(workdir, this.runner, this.terraformVars())
		})
		return { handled: true, detail: 'applied' }
	}

	// account_id is only referenced by account-scoped resources; when none are
	// declared the generated config omits the `variable` block, so passing
	// TF_VAR_account_id would be an undeclared variable. Mirror the domain's
	// own condition (the generated `variable` block) instead of passing blindly.
	private terraformVars(): Record<string, string> {
		const mainConfig = buildTerraformMainConfig(
			this.config,
			this.environment,
		)
		if (mainConfig.variable === undefined) return {}
		return { account_id: this.accountId }
	}

	private async withTerraformWorkdir<T>(
		run: (workdir: string) => Promise<T>,
	): Promise<T> {
		const workdir = await mkdtemp(join(tmpdir(), WORKDIR_PREFIX))
		try {
			await writeTerraformConfig(
				workdir,
				buildTerraformMainConfig(this.config, this.environment),
			)
			return await run(workdir)
		} finally {
			await rm(workdir, { recursive: true, force: true })
		}
	}
}
