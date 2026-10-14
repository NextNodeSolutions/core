import {
	defaultWranglerRunner,
	wranglerDelete,
} from '#/adapters/wrangler/runner.ts'
import { WORKERS_TEARDOWN_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import { computeWorkerScriptName } from '#/domain/cloudflare/workers/worker-name.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'

import { withWorkersTerraformTeardown } from './terraform-ops.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WorkersTeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersTerraformContext } from './terraform-ops.ts'

export type { WranglerRunner }

export interface WorkersTeardownInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceNames: ReadonlyArray<string>
	readonly wranglerRunner: WranglerRunner | undefined
	readonly terraformContext: WorkersTerraformContext
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

export async function teardownWorkers(
	input: WorkersTeardownInput,
): Promise<WorkersTeardownResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const outcome = await withWorkersTerraformTeardown(
		input.terraformContext,
		destroyTerraform =>
			executeHandlers(WORKERS_TEARDOWN_RESOURCES, {
				workers: () => deleteWorkerScripts(input, runner),
				terraform: destroyTerraform,
			}),
	)
	return {
		kind: 'workers',
		scope: 'project',
		outcome,
		durationMs: Date.now() - start,
	}
}
