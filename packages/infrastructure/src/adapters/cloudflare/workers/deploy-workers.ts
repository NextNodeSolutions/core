import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import { defaultWranglerRunner } from '#/adapters/wrangler/runner.ts'
import { orderServicesByDependsOn } from '#/domain/cloudflare/workers/depends-on-order.ts'
import { buildWranglerConfig } from '#/domain/cloudflare/workers/wrangler-config.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type {
	CronJobConfig,
	ServicesConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { DeployedWorker, DeployResult } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export interface WorkersDeployInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly domain: string
	readonly services: Readonly<Record<string, WorkerServiceConfig>>
	// The [services.*] block (backing resources); bindings are filtered per
	// service by `needs` inside `buildWranglerConfig`.
	readonly backingServices: ServicesConfig
	readonly cron: ReadonlyArray<CronJobConfig>
	// Provision outputs, read ONCE by the caller and shared across every service.
	readonly outputs: WorkersTerraformOutputs
	readonly wranglerRunner: WranglerRunner | undefined
	// The project package dir `wrangler deploy` runs from.
	readonly projectDir: string
}

function workerUrl(
	service: WorkerServiceConfig,
	environment: AppEnvironment,
): string {
	if (service.url === undefined) return ''
	return computeSiteUrl(service.url, environment)
}

/**
 * Deploy every Worker in the project, one `wrangler deploy` per service, in
 * `depends_on` order (a service deploys after every service it depends on). Each
 * service's ephemeral wrangler config is generated in the domain and written by
 * the adapter; a failed deploy throws and stops the run (later services are not
 * deployed). Returns a single `worker` deployed-environment carrying every
 * service's resolved URL for the summary.
 */
export async function deployWorkers(
	input: WorkersDeployInput,
): Promise<DeployResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const serviceNames = Object.keys(input.services)
	const order = orderServicesByDependsOn(input.services)

	const deployed: Array<DeployedWorker> = []
	for (const serviceName of order) {
		const service = input.services[serviceName]
		if (service === undefined) continue
		const document = buildWranglerConfig({
			projectName: input.projectName,
			environment: input.environment,
			serviceName,
			service,
			services: input.backingServices,
			outputs: input.outputs,
			cron: input.cron,
			serviceNames,
			vars: {},
		})
		// eslint-disable-next-line no-await-in-loop -- deploys are strictly sequential (depends_on order); parallelism would break the ordering contract
		await wranglerDeploy({ document, runner, cwd: input.projectDir })
		deployed.push({
			name: serviceName,
			url: workerUrl(service, input.environment),
		})
	}

	return {
		projectName: input.projectName,
		deployedEnvironments: [
			{
				kind: 'worker',
				name: input.environment,
				url: computeSiteUrl(input.domain, input.environment),
				workers: deployed,
				deployedAt: new Date(),
			},
		],
		durationMs: Date.now() - start,
	}
}
