import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import { defaultWranglerRunner } from '#/adapters/wrangler/runner.ts'
import { orderServicesByDependsOn } from '#/domain/cloudflare/workers/depends-on-order.ts'
import { deriveWorkersBackingConfig } from '#/domain/cloudflare/workers/outputs-env.ts'
import { computeSmokeCheckUrls } from '#/domain/cloudflare/workers/smoke-check.ts'
import { buildWorkerVars } from '#/domain/cloudflare/workers/worker-vars.ts'
import { buildWranglerConfig } from '#/domain/cloudflare/workers/wrangler-config.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { buildServiceSecretEnv } from '#/domain/hetzner/service-env.ts'

import { smokeCheckWorkers } from './smoke-check.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type {
	CronJobConfig,
	ServicesConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
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
	// Resolved secret VALUES (the pool = [deploy].secrets global ∪ each service's
	// own, already folded and resolved from ALL_SECRETS upstream) and their
	// provenance. Projected per service, least-privilege, via `buildServiceSecretEnv`.
	readonly secrets: Readonly<Record<string, string>>
	readonly secretOrigins: Readonly<Record<string, string>>
	// The Cloudflare account id, needed to derive R2_ENDPOINT for the backing vars.
	readonly accountId: string
	readonly wranglerRunner: WranglerRunner | undefined
	// The project package dir `wrangler deploy` runs from.
	readonly projectDir: string
	// Injection point for tests; production waits with a real timer between
	// post-deploy smoke-check retries.
	readonly smokeCheckSleep?: ((ms: number) => Promise<void>) | undefined
}

function workerUrl(
	service: WorkerServiceConfig,
	environment: AppEnvironment,
): string {
	if (service.url === undefined) return ''
	return computeSiteUrl(service.url, environment)
}

const SECRETS_JSON_INDENT = 2

// A worker with no projected secrets makes NO `wrangler secret bulk` call
// (undefined), so an empty declaration never spawns an empty upload.
function secretsJsonFor(
	secrets: Readonly<Record<string, string>> | undefined,
): string | undefined {
	if (secrets === undefined || Object.keys(secrets).length === 0) {
		return undefined
	}
	return JSON.stringify(secrets, null, SECRETS_JSON_INDENT)
}

function buildServiceDocument(
	input: WorkersDeployInput,
	serviceName: string,
	service: WorkerServiceConfig,
): WranglerDocument {
	return buildWranglerConfig({
		projectName: input.projectName,
		environment: input.environment,
		serviceName,
		service,
		services: input.backingServices,
		outputs: input.outputs,
		cron: input.cron,
		serviceNames: Object.keys(input.services),
		vars: buildWorkerVars({
			projectDomain: input.domain,
			environment: input.environment,
			service,
			services: input.services,
			backing: deriveWorkersBackingConfig(input.backingServices),
			outputs: input.outputs,
			accountId: input.accountId,
		}),
	})
}

/**
 * Deploy every Worker in the project, one `wrangler deploy` per service, in
 * `depends_on` order (a service deploys after every service it depends on). Each
 * service's ephemeral wrangler config is generated in the domain and written by
 * the adapter; its projected secrets are then bulk-uploaded against the same
 * config (worker must exist first). A failed deploy throws and stops the run
 * (later services are not deployed). Once every service is deployed, each routed
 * service is smoke-checked on `/healthz` (bounded retries); an unhealthy service
 * throws so the deploy job fails. Returns a single `worker` deployed-environment
 * carrying every service's resolved URL for the summary.
 */
export async function deployWorkers(
	input: WorkersDeployInput,
): Promise<DeployResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const order = orderServicesByDependsOn(input.services)
	const perServiceSecrets = buildServiceSecretEnv(
		input.services,
		input.secrets,
		input.secretOrigins,
	)

	const deployed: Array<DeployedWorker> = []
	for (const serviceName of order) {
		const service = input.services[serviceName]
		if (service === undefined) continue
		const document = buildServiceDocument(input, serviceName, service)
		const secretsJson = secretsJsonFor(perServiceSecrets[serviceName])
		// eslint-disable-next-line no-await-in-loop -- deploys are strictly sequential (depends_on order); parallelism would break the ordering contract
		await wranglerDeploy({
			document,
			runner,
			cwd: input.projectDir,
			...(secretsJson === undefined ? {} : { secretsJson }),
		})
		deployed.push({
			name: serviceName,
			url: workerUrl(service, input.environment),
		})
	}

	await smokeCheckWorkers(
		computeSmokeCheckUrls(input.services, input.environment),
		{ sleep: input.smokeCheckSleep },
	)

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
