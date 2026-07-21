import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { ensureHcpWorkspace } from '#/adapters/hcp/workspaces.ts'
import { defaultTerraformRunner } from '#/adapters/terraform/runner.ts'
import { WORKERS_MANAGED_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import {
	EMPTY_WORKERS_TERRAFORM_OUTPUTS,
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	hasWorkersBacking,
} from '#/domain/cloudflare/workers/outputs-env.ts'
import { HCP_TERRAFORM_ORGANIZATION } from '#/domain/cloudflare/workers/terraform-config.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'

import { deployWorkers } from './deploy-workers.ts'
import { migrateWorkers } from './migrate-workers.ts'
import { teardownWorkers } from './teardown-workers.ts'
import {
	applyWorkersTerraform,
	destroyWorkersTerraform,
	memoizeOutputsReader,
	planWorkersTerraform,
	readWorkersTerraformOutputs,
} from './terraform-ops.ts'

import type { TerraformRunner } from '#/adapters/terraform/runner.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
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
	TargetEnv,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import type { OutputsReader, WorkersTerraformContext } from './terraform-ops.ts'

export interface CloudflareWorkersTargetConfig {
	readonly accountId: string
	readonly hcpToken: string
	readonly environment: AppEnvironment
	readonly config: CloudflareWorkersDeployableConfig
	// The project package directory `wrangler deploy` runs from - the built
	// bundle + assets (`main`, `assets.directory`) resolve against it. Resolved
	// by the CLI factory from PIPELINE_CONFIG_FILE (mirrors plan's package dir).
	// Optional so provision/teardown-only constructions (and tests) that never
	// deploy need not supply it; `deploy` fails loud if it is missing.
	readonly projectDir?: string
	// Injection point for tests; production shells out to the `terraform` binary.
	readonly terraformRunner?: TerraformRunner
	// Injection point for tests; production shells out to `npx wrangler`.
	readonly wranglerRunner?: WranglerRunner
}

export class CloudflareWorkersTarget implements DeployTarget {
	readonly name = 'cloudflare-workers'
	private readonly accountId: string
	private readonly hcpToken: string
	private readonly environment: AppEnvironment
	private readonly config: CloudflareWorkersDeployableConfig
	private readonly projectDir: string | undefined
	private readonly runner: TerraformRunner
	private readonly wrangler: WranglerRunner | undefined
	// Memoised across loadBackingEnv, deploy and runMigrate so one deploy/migrate
	// flow reads the provision outputs once. Skips terraform entirely (EMPTY) when
	// no backing service is declared - the only Terraform-emitted ids live there.
	private readonly loadTerraformOutputs: OutputsReader

	constructor(config: CloudflareWorkersTargetConfig) {
		this.accountId = config.accountId
		this.hcpToken = config.hcpToken
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

		const outcome = await executeHandlers(WORKERS_MANAGED_RESOURCES, {
			'hcp-workspace': () =>
				ensureHcpWorkspace({
					organization: HCP_TERRAFORM_ORGANIZATION,
					workspaceName,
					token: this.hcpToken,
				}),
			terraform: () => applyWorkersTerraform(this.terraformContext()),
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

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		void projectName
		void domain
		logger.info(
			`reconcileDns is a no-op for ${this.name}: apex/redirect DNS is provisioned by Terraform (Redirect Rules + support records) and Worker custom domains are attached by wrangler at deploy - nothing to reconcile here.`,
		)
	}

	// Read the provision outputs ONCE, then hand off to `deployWorkers`, which
	// generates an ephemeral wrangler config per service and runs `wrangler
	// deploy` sequentially in depends_on order. `input`/`env` (vars + secrets)
	// are wired in US-3.2.
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
			services: this.config.deploy.services,
			backingServices: this.config.services,
			cron: this.config.deploy.cron,
			outputs,
			secrets: input.secrets,
			secretOrigins: input.secretOrigins,
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
			environment: this.environment,
			runner: this.runner,
			accountId: this.accountId,
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
			`prepareRollout is not applicable to ${this.name}: there is no database to stage before migrate. D1 migrations run via \`wrangler d1 migrations apply\` with no rollout staging.`,
		)
	}

	async runMigrate(input: MigrateInput): Promise<MigrateResult> {
		if (input.kind !== 'd1') {
			throw new Error(
				`runMigrate on ${this.name} expects a d1 migrate input but received "${input.kind}" - a container migrate was routed to the Workers target, which is a wiring bug.`,
			)
		}
		const outputs = await this.loadTerraformOutputs()
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

	// The wipe-data gate (D1/R2 data loss) is a domain decision the CLI asserts
	// before calling teardown; scope/volumes are Hetzner-only, so they are unused
	// here. The workers-are-deleted-then-Terraform-destroyed sequence lives in
	// `teardownWorkers`; the HCP workspace is never deleted (state stays
	// historised) and the zone + other pipelines' records are data-sourced, never
	// owned, so they survive untouched.
	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		shouldWipeVolumes: boolean,
	): Promise<TeardownResult> {
		void domain
		void target
		void shouldWipeVolumes
		return teardownWorkers({
			projectName,
			environment: this.environment,
			serviceNames: Object.keys(this.config.deploy.services),
			wranglerRunner: this.wrangler,
			destroyTerraform: () =>
				destroyWorkersTerraform(this.terraformContext()),
		})
	}

	// Full init + plan even with no backing services (the workspace still owns
	// redirect rules + support DNS records). The context carries the project, so
	// no projectName is needed; the plan text is returned verbatim.
	planDiff(): Promise<string> {
		return planWorkersTerraform(this.terraformContext())
	}

	recover(projectName: string): Promise<void> {
		logger.info(
			`recover is a no-op on ${this.name} for "${projectName}": the Terraform state is the source of truth, so there is nothing to reconcile.`,
		)
		return Promise.resolve()
	}
}
