import {
	defaultWranglerRunner,
	wranglerDelete,
} from '#/adapters/wrangler/runner.ts'
import { WORKERS_TEARDOWN_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import { computeWorkerScriptName } from '#/domain/cloudflare/workers/worker-name.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WorkersTeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export type { WranglerRunner }

export interface WorkersTeardownInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceNames: ReadonlyArray<string>
	readonly wranglerRunner: WranglerRunner | undefined
	readonly destroyTerraform: () => Promise<ResourceOutcome>
}

async function deleteWorkerScripts(
	input: WorkersTeardownInput,
	runner: WranglerRunner,
): Promise<ResourceOutcome> {
	const outcomes: Array<ResourceOutcome> = []
	for (const serviceName of input.serviceNames) {
		const scriptName = computeWorkerScriptName(
			input.projectName,
			input.environment,
			serviceName,
		)
		// eslint-disable-next-line no-await-in-loop -- sequential deletes give a deterministic aggregated detail and avoid hammering the API
		outcomes.push(await wranglerDelete(scriptName, runner))
	}
	return {
		handled: outcomes.some(outcome => outcome.handled),
		detail: outcomes.map(outcome => outcome.detail).join('; '),
	}
}

/**
 * Tear down a cloudflare-workers project: delete every Worker script via
 * wrangler FIRST (so no live traffic hits soon-to-be-destroyed backing infra),
 * then run `destroyTerraform` to remove the D1/KV/Queues/R2 + Redirect Rules.
 * The HCP workspace is never deleted - the Terraform state stays historised.
 */
export async function teardownWorkers(
	input: WorkersTeardownInput,
): Promise<WorkersTeardownResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const outcome = await executeHandlers(WORKERS_TEARDOWN_RESOURCES, {
		workers: () => deleteWorkerScripts(input, runner),
		terraform: input.destroyTerraform,
	})
	return {
		kind: 'workers',
		scope: 'project',
		outcome,
		durationMs: Date.now() - start,
	}
}
