import { defaultDockerRunner } from '#/adapters/docker/runner.ts'
import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import { defaultWranglerRunner } from '#/adapters/wrangler/runner.ts'
import { deriveWorkersBackingConfig } from '#/domain/cloudflare/workers/outputs-env.ts'
import { orderWorkerDeploy } from '#/domain/cloudflare/workers/service-bindings.ts'
import { computeSmokeCheckUrls } from '#/domain/cloudflare/workers/smoke-check.ts'
import { buildWorkerVars } from '#/domain/cloudflare/workers/worker-vars.ts'
import { buildWranglerConfig } from '#/domain/cloudflare/workers/wrangler-config.ts'
import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import { deployContainerService } from './deploy-container-service.ts'
import {
	planContainerImagePrune,
	pruneContainerImages,
} from './prune-container-images.ts'
import { injectSeoGuardAssets } from './seo-guard-assets.ts'
import { smokeCheckWorkers } from './smoke-check.ts'
import { removeSourcemapAssets } from './sourcemap-assets.ts'

import type { DockerRunner } from '#/adapters/docker/runner.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ServicesConfig } from '#/config/service-config.ts'
import type {
	ContainerServiceConfig,
	CronJobConfig,
	DeployServiceConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { ImagePrunePlan } from '#/domain/cloudflare/workers/container-image-prune.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { WranglerDocument } from '#/domain/cloudflare/workers/wrangler-document.ts'
import type { DeployedWorker, DeployResult } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	CloudflareApiAccess,
	ContainerImageSource,
} from './deploy-container-service.ts'

export interface WorkersDeployInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly domain: string
	readonly services: Readonly<Record<string, DeployServiceConfig>>
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
	// The REST API access the container applications are read with.
	readonly cloudflareApi: CloudflareApiAccess
	readonly wranglerRunner: WranglerRunner | undefined
	// The project package dir `wrangler deploy` runs from.
	readonly projectDir: string
	// The images the `containers` job built, downloaded by the deploy job.
	// Required only when a container service is declared.
	readonly containerImages?: ContainerImageSource | undefined
	readonly dockerRunner?: DockerRunner | undefined
	// Injection point for tests; production waits with a real timer between
	// post-deploy smoke-check retries.
	readonly smokeCheckSleep?: ((ms: number) => Promise<void>) | undefined
}

function workerUrl(
	service: DeployServiceConfig,
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

// The public vars of a Worker, or of a container service's gateway (which
// hands them to the container).
function serviceVars(
	input: WorkersDeployInput,
	serviceName: string,
	service: DeployServiceConfig,
): Record<string, string> {
	return buildWorkerVars({
		projectDomain: input.domain,
		environment: input.environment,
		serviceName,
		service,
		backing: deriveWorkersBackingConfig(input.backingServices),
		outputs: input.outputs,
		accountId: input.accountId,
	})
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
		vars: serviceVars(input, serviceName, service),
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
}

// Deploy one Worker: generate its config, inject the non-prod SEO guard into
// its assets directory (so a non-prod deploy is not indexable) and remove its
// source maps (so the original source is not served) BEFORE the upload,
// then `wrangler deploy` and sync its secrets against the same
// config. A failed deploy throws (the caller stops the run).
async function deployWorkerService(
	job: ServiceDeployJob,
	service: WorkerServiceConfig,
): Promise<void> {
	const { input, serviceName } = job
	const document = buildServiceDocument(input, serviceName, service)
	if (document.assets) {
		injectSeoGuardAssets(
			input.projectDir,
			document.assets.directory,
			input.environment,
		)
		await removeSourcemapAssets(input.projectDir, document.assets.directory)
	}
	await wranglerDeploy({
		document,
		runner: job.runner,
		cwd: input.projectDir,
		...secretsArg(secretsFor(service, input.secrets)),
	})
}

function requireContainerImages(
	input: WorkersDeployInput,
	serviceName: string,
): ContainerImageSource {
	if (typeof input.containerImages !== 'undefined')
		return input.containerImages
	throw new Error(
		`container service "${serviceName}" needs its built image, but no image directory was given - the deploy job sets CONTAINER_IMAGES_DIR and IMAGE_TAG after downloading the \`containers\` job's artifact`,
	)
}

function deployContainer(
	job: ServiceDeployJob,
	service: ContainerServiceConfig,
): Promise<void> {
	const { input, serviceName } = job
	return deployContainerService({
		projectName: input.projectName,
		environment: input.environment,
		accountId: input.accountId,
		serviceName,
		service,
		vars: serviceVars(input, serviceName, service),
		outputs: input.outputs,
		projectSecrets: input.secrets,
		images: requireContainerImages(input, serviceName),
		wranglerRunner: job.runner,
		dockerRunner: input.dockerRunner ?? defaultDockerRunner,
		projectDir: input.projectDir,
	})
}

// Read before any push which image each container runs, so the prune after
// the smoke checks keeps it for a rollback.
function containerPrunePlans(
	input: WorkersDeployInput,
): Promise<ReadonlyArray<ImagePrunePlan>> {
	if (!input.containerImages) return Promise.resolve([])
	return planContainerImagePrune({
		projectName: input.projectName,
		environment: input.environment,
		services: input.services,
		deployedTag: input.containerImages.imageTag,
		cloudflareApi: input.cloudflareApi,
	})
}

async function deployOneService(
	job: ServiceDeployJob,
	service: DeployServiceConfig,
): Promise<DeployedWorker> {
	if (service.kind === 'container') await deployContainer(job, service)
	else await deployWorkerService(job, service)
	return {
		name: job.serviceName,
		url: workerUrl(service, job.input.environment),
	}
}

/**
 * Deploy every service in the project, one `wrangler deploy` per service, in
 * binding order (a service deploys after every sibling it binds via `needs`, so
 * a service binding's target script always exists first) and after any explicit
 * `depends_on`. Each
 * service's ephemeral wrangler config is generated in the domain and written by
 * the adapter; an asset-shipping service gets the non-prod SEO guard injected
 * into its assets directory before upload, and its secrets are synced
 * against the same config (see `deployWorkerService`). A container service
 * pushes its prebuilt image and deploys core's gateway Worker in front of it
 * (see `deployContainerService`). A failed deploy
 * throws and stops the run (later services are not deployed). Once every service
 * is deployed, each public routed service is smoke-checked on `/healthz` (retried
 * until one shared deadline, and a container must answer with this deploy's
 * release); an unhealthy service throws so the deploy job fails. Only then are
 * the older registry tags of each container image pruned, keeping the new tag
 * and the one each application ran before the deploy. Returns a single
 * `worker` deployed-environment carrying every service's resolved URL.
 */
export async function deployWorkers(
	input: WorkersDeployInput,
): Promise<DeployResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const order = orderWorkerDeploy(input.services)
	const prunePlans = await containerPrunePlans(input)

	const deployed: Array<DeployedWorker> = []
	for (const serviceName of order) {
		const service = input.services[serviceName]
		if (!service) continue
		deployed.push(
			// eslint-disable-next-line no-await-in-loop -- deploys are strictly sequential (depends_on order); parallelism would break the ordering contract
			await deployOneService({ input, runner, serviceName }, service),
		)
	}

	await smokeCheckWorkers(
		computeSmokeCheckUrls(
			input.services,
			input.environment,
			input.containerImages?.release,
		),
		{ sleep: input.smokeCheckSleep },
	)
	await pruneContainerImages(prunePlans, runner)

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
