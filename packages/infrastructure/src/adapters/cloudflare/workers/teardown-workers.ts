import { emptyR2Buckets } from '#/adapters/cloudflare/r2/bucket-objects.ts'
import { deriveS3Credentials } from '#/adapters/cloudflare/r2/s3-credentials.ts'
import { deleteContainerApplication } from '#/adapters/wrangler/container-applications.ts'
import { deleteContainerImageTags } from '#/adapters/wrangler/containers.ts'
import {
	defaultWranglerRunner,
	wranglerDelete,
} from '#/adapters/wrangler/runner.ts'
import { WORKERS_TEARDOWN_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import { computeWorkerScriptName } from '#/domain/cloudflare/workers/worker-name.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import { computeR2BucketName } from '#/domain/services/r2.ts'

import { withWorkersTerraformTeardown } from './terraform-ops.ts'

import type { CloudflareApiAccess } from '#/adapters/cloudflare/api.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { DeployServiceConfig } from '#/config/types.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WorkersTeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersTerraformContext } from './terraform-ops.ts'

export type { WranglerRunner }

export interface WorkersTeardownInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	// Every declared service; a container service also owns a container
	// application and a registry image.
	readonly services: Readonly<Record<string, DeployServiceConfig>>
	readonly wranglerRunner: WranglerRunner | undefined
	readonly terraformContext: WorkersTerraformContext
	// The CI token: it reads the container applications and, as an S3 key
	// pair, empties the buckets.
	readonly cloudflareApi: CloudflareApiAccess
}

interface TeardownTools {
	readonly cloudflareApi: CloudflareApiAccess
	readonly runner: WranglerRunner
}

// A container service is three resources under one name: the application
// goes first (`wrangler delete` leaves it running), then the gateway Worker
// and its Durable Object namespace, then the registry image nothing pulls any
// more.
async function deleteContainerService(
	scriptName: string,
	tools: TeardownTools,
): Promise<ReadonlyArray<ResourceOutcome>> {
	const application = await deleteContainerApplication(
		scriptName,
		tools.cloudflareApi,
		tools.runner,
	)
	const gateway = await wranglerDelete(scriptName, tools.runner)
	const image = await deleteContainerImageTags(scriptName, [], tools.runner)
	return [application, gateway, image]
}

async function deleteService(
	scriptName: string,
	service: DeployServiceConfig,
	tools: TeardownTools,
): Promise<ReadonlyArray<ResourceOutcome>> {
	if (service.kind === 'container')
		return deleteContainerService(scriptName, tools)
	return [await wranglerDelete(scriptName, tools.runner)]
}

async function deleteWorkerScripts(
	input: WorkersTeardownInput,
	tools: TeardownTools,
): Promise<ResourceOutcome> {
	const outcomes: Array<ResourceOutcome> = []
	for (const [serviceName, service] of Object.entries(input.services)) {
		const scriptName = computeWorkerScriptName(
			input.projectName,
			input.environment,
			serviceName,
		)
		// eslint-disable-next-line no-await-in-loop -- sequential deletes give a deterministic aggregated detail and avoid hammering the API
		outcomes.push(...(await deleteService(scriptName, service, tools)))
	}
	return {
		handled: outcomes.some(outcome => outcome.handled),
		detail: outcomes.map(outcome => outcome.detail).join('; '),
	}
}

function declaredBucketNames(
	input: WorkersTeardownInput,
): ReadonlyArray<string> {
	const buckets = input.terraformContext.config.services.r2?.buckets ?? []
	return buckets.map(bucket =>
		computeR2BucketName(input.projectName, input.environment, bucket.name),
	)
}

// The CI token signs the S3 calls as a key pair derived from it: no token is
// created for the teardown.
async function emptyDeclaredBuckets(
	input: WorkersTeardownInput,
): Promise<ResourceOutcome> {
	const buckets = declaredBucketNames(input)
	if (!buckets.length) return { handled: false, detail: 'no bucket' }
	const credentials = await deriveS3Credentials(input.cloudflareApi)
	return emptyR2Buckets(
		{ accountId: input.cloudflareApi.accountId, credentials },
		buckets,
	)
}

export async function teardownWorkers(
	input: WorkersTeardownInput,
): Promise<WorkersTeardownResult> {
	const start = Date.now()
	const tools: TeardownTools = {
		cloudflareApi: input.cloudflareApi,
		runner: input.wranglerRunner ?? defaultWranglerRunner,
	}
	const outcome = await withWorkersTerraformTeardown(
		input.terraformContext,
		destroyTerraform =>
			executeHandlers(WORKERS_TEARDOWN_RESOURCES, {
				workers: () => deleteWorkerScripts(input, tools),
				'r2-objects': () => emptyDeclaredBuckets(input),
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
