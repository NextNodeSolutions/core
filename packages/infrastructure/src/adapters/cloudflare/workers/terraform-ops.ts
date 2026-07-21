import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	terraformApply,
	terraformDestroy,
	terraformInit,
	terraformOutputJson,
	terraformPlan,
	writeTerraformConfig,
} from '#/adapters/terraform/runner.ts'
import { parseTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import { buildTerraformMainConfig } from '#/domain/deploy/terraform-config.ts'

import type { TerraformRunner } from '#/adapters/terraform/runner.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const WORKDIR_PREFIX = 'nn-workers-tf-'

export interface WorkersTerraformContext {
	readonly config: CloudflareWorkersDeployableConfig
	readonly environment: AppEnvironment
	readonly runner: TerraformRunner
	readonly accountId: string
}

// account_id is only referenced by account-scoped resources; when none are
// declared the generated config omits the `variable` block, so passing
// TF_VAR_account_id would be an undeclared variable. Mirror the domain's own
// condition (the generated `variable` block) instead of passing blindly.
function terraformVars(ctx: WorkersTerraformContext): Record<string, string> {
	const mainConfig = buildTerraformMainConfig(ctx.config, ctx.environment)
	if (mainConfig.variable === undefined) return {}
	return { account_id: ctx.accountId }
}

// Materialise the generated main.tf.json in a scratch workdir, run `run`, and
// remove the workdir in `finally` - no config or state ever persists on disk
// between operations.
async function withWorkdir<T>(
	ctx: WorkersTerraformContext,
	run: (workdir: string) => Promise<T>,
): Promise<T> {
	const workdir = await mkdtemp(join(tmpdir(), WORKDIR_PREFIX))
	try {
		await writeTerraformConfig(
			workdir,
			buildTerraformMainConfig(ctx.config, ctx.environment),
		)
		return await run(workdir)
	} finally {
		await rm(workdir, { recursive: true, force: true })
	}
}

export async function applyWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<ResourceOutcome> {
	await withWorkdir(ctx, async workdir => {
		await terraformInit(workdir, ctx.runner)
		await terraformApply(workdir, ctx.runner, terraformVars(ctx))
	})
	return { handled: true, detail: 'applied' }
}

export async function destroyWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<ResourceOutcome> {
	await withWorkdir(ctx, async workdir => {
		await terraformInit(workdir, ctx.runner)
		await terraformDestroy(workdir, ctx.runner, terraformVars(ctx))
	})
	return { handled: true, detail: 'destroyed' }
}

export function planWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<string> {
	return withWorkdir(ctx, async workdir => {
		await terraformInit(workdir, ctx.runner)
		const plan = await terraformPlan(
			workdir,
			ctx.runner,
			terraformVars(ctx),
		)
		return plan.planText
	})
}

export function readWorkersTerraformOutputs(
	ctx: WorkersTerraformContext,
): Promise<WorkersTerraformOutputs> {
	return withWorkdir(ctx, async workdir => {
		await terraformInit(workdir, ctx.runner)
		const raw = await terraformOutputJson(workdir, ctx.runner)
		return parseTerraformOutputs(raw)
	})
}
