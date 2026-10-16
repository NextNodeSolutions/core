import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import { defaultWranglerRunner } from '#/adapters/wrangler/runner.ts'
import { deriveWorkersBackingConfig } from '#/domain/cloudflare/workers/outputs-env.ts'
import { orderWorkerDeploy } from '#/domain/cloudflare/workers/service-bindings.ts'
import { computeSmokeCheckUrls } from '#/domain/cloudflare/workers/smoke-check.ts'
import { buildWorkerVars } from '#/domain/cloudflare/workers/worker-vars.ts'
import { buildWranglerConfig } from '#/domain/cloudflare/workers/wrangler-config.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import { injectSeoGuardAssets } from './seo-guard-assets.ts'
import { smokeCheckWorkers } from './smoke-check.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ServicesConfig } from '#/config/service-config.ts'
import type { CronJobConfig, WorkerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { DeployedWorker, DeployResult } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export interface WorkersDeployInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly domain: string
	// The organization's Zero Trust team domain, projected into internal Workers.
	readonly accessTeamDomain: string | undefined
	readonly services: Readonly<Record<string, WorkerServiceConfig>>
	// The [services.*] block (backing resources); bindings are filtered per
	// service by `needs` inside `buildWranglerConfig`.
	readonly backingServices: ServicesConfig
	readonly cron: ReadonlyArray<CronJobConfig>
	// Provision outputs, read ONCE by the caller and shared across every service.
	readonly outputs: WorkersTerraformOutputs
	// The secrets every scripted Worker of the project holds after the deploy:
	// the repository's whole Infisical environment. Undefined when the
	// repository has no Infisical project: the Workers' secrets are left as
	// they are.
	readonly secrets: Readonly<Record<string, string>> | undefined
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
	if (typeof service.url === 'undefined') return ''
	return computeSiteUrl(service.url, environment)
}

// A static-assets-only Worker (entry = false) runs no code that could read a
// secret: its secrets are never synced.
function secretsFor(
	service: WorkerServiceConfig,
	secrets: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
	if (service.entry === false) return undefined
	return secrets
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
			serviceName,
			service,
			backing: deriveWorkersBackingConfig(input.backingServices),
			outputs: input.outputs,
			accountId: input.accountId,
			accessTeamDomain: input.accessTeamDomain,
		}),
	})
}

function secretsArg(
	secrets: Readonly<Record<string, string>> | undefined,
): { secrets: Readonly<Record<string, string>> } | undefined {
	if (typeof secrets === 'undefined') return undefined
	return { secrets }
}

interface ServiceDeployJob {
	readonly input: WorkersDeployInput
	readonly runner: WranglerRunner
	readonly serviceName: string
	readonly service: WorkerServiceConfig
	readonly secrets: Readonly<Record<string, string>> | undefined
}

// Deploy one service: generate its config, inject the non-prod SEO guard into
// its assets directory (so a non-prod deploy is not indexable) BEFORE the upload,
// then `wrangler deploy` and sync its secrets against the same
// config. A failed deploy throws (the caller stops the run).
async function deployOneService(
	job: ServiceDeployJob,
): Promise<DeployedWorker> {
	const { input, serviceName, service } = job
	const document = buildServiceDocument(input, serviceName, service)
	if (document.assets) {
		injectSeoGuardAssets(
			input.projectDir,
			document.assets.directory,
			input.environment,
		)
	}
	await wranglerDeploy({
		document,
		runner: job.runner,
		cwd: input.projectDir,
		...secretsArg(job.secrets),
	})
	return { name: serviceName, url: workerUrl(service, input.environment) }
}

/**
 * Deploy every Worker in the project, one `wrangler deploy` per service, in
 * binding order (a service deploys after every sibling it binds via `needs`, so
 * a service binding's target script always exists first) and after any explicit
 * `depends_on`. Each
 * service's ephemeral wrangler config is generated in the domain and written by
 * the adapter; an asset-shipping service gets the non-prod SEO guard injected
 * into its assets directory before upload, and its secrets are synced
 * against the same config (see `deployOneService`). A failed deploy
 * throws and stops the run (later services are not deployed). Once every service
 * is deployed, each public routed service is smoke-checked on `/healthz` (bounded
 * retries); an unhealthy service throws so the deploy job fails. Returns a single
 * `worker` deployed-environment carrying every service's resolved URL.
 */
export async function deployWorkers(
	input: WorkersDeployInput,
): Promise<DeployResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const order = orderWorkerDeploy(input.services)

	const deployed: Array<DeployedWorker> = []
	for (const serviceName of order) {
		const service = input.services[serviceName]
		if (!service) continue
		deployed.push(
			// eslint-disable-next-line no-await-in-loop -- deploys are strictly sequential (depends_on order); parallelism would break the ordering contract
			await deployOneService({
				input,
				runner,
				serviceName,
				service,
				secrets: secretsFor(service, input.secrets),
			}),
		)
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
