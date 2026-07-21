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

// Materialise the generated main.tf.json in a scratch workdir, initialise it,
// run `run` with the initialised workdir and its terraform vars, then remove the
// workdir in `finally` - no config or state ever persists on disk between
// operations. account_id is only referenced by account-scoped resources; when
// none are declared the generated config omits the `variable` block, so passing
// TF_VAR_account_id would be an undeclared variable - mirror the domain's own
// condition (the generated `variable` block) instead of passing blindly.
async function withWorkdir<T>(
	ctx: WorkersTerraformContext,
	run: (workdir: string, vars: Record<string, string>) => Promise<T>,
): Promise<T> {
	const mainConfig = buildTerraformMainConfig(ctx.config, ctx.environment)
	const vars =
		mainConfig.variable === undefined ? {} : { account_id: ctx.accountId }
	const workdir = await mkdtemp(join(tmpdir(), WORKDIR_PREFIX))
	try {
		await writeTerraformConfig(workdir, mainConfig)
		await terraformInit(workdir, ctx.runner)
		return await run(workdir, vars)
	} finally {
		await rm(workdir, { recursive: true, force: true })
	}
}

export async function applyWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<ResourceOutcome> {
	await withWorkdir(ctx, (workdir, vars) =>
		terraformApply(workdir, ctx.runner, vars),
	)
	return { handled: true, detail: 'applied' }
}

export async function destroyWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<ResourceOutcome> {
	await withWorkdir(ctx, (workdir, vars) =>
		terraformDestroy(workdir, ctx.runner, vars),
	)
	return { handled: true, detail: 'destroyed' }
}

export function planWorkersTerraform(
	ctx: WorkersTerraformContext,
): Promise<string> {
	return withWorkdir(ctx, async (workdir, vars) => {
		const plan = await terraformPlan(workdir, ctx.runner, vars)
		return plan.planText
	})
}

export function readWorkersTerraformOutputs(
	ctx: WorkersTerraformContext,
): Promise<WorkersTerraformOutputs> {
	return withWorkdir(ctx, async workdir => {
		const raw = await terraformOutputJson(workdir, ctx.runner)
		return parseTerraformOutputs(raw)
	})
}

export type OutputsReader = () => Promise<WorkersTerraformOutputs>

// Memoise a single provision-outputs read so one deploy/migrate flow pays the
// `terraform init`+`output` roundtrip once (loadBackingEnv, then
// loadDeployOutputs/runMigrate share it). Concurrent and later callers reuse the
// in-flight Promise; a rejection clears the cache so a retry re-reads instead of
// replaying the failure.
export function memoizeOutputsReader(read: OutputsReader): OutputsReader {
	let cached: Promise<WorkersTerraformOutputs> | undefined
	const run = async (): Promise<WorkersTerraformOutputs> => {
		try {
			return await read()
		} catch (error) {
			cached = undefined
			throw error
		}
	}
	return () => (cached ??= run())
}
