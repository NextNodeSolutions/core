import { join } from 'node:path'

import { loadContainerImage } from '#/adapters/docker/images.ts'
import { wranglerContainersPush } from '#/adapters/wrangler/containers.ts'
import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import {
	computeContainerImageReference,
	computeContainerImageTag,
	containerImageArchiveName,
} from '#/domain/cloudflare/workers/container-image.ts'
import {
	buildContainerBackingSecrets,
	resolveContainerSecrets,
} from '#/domain/cloudflare/workers/container-secrets.ts'
import { buildContainerWranglerConfig } from '#/domain/cloudflare/workers/container-wrangler-config.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { resolveContainerGatewayEntry } from './container-gateway-entry.ts'

import type { DockerRunner } from '#/adapters/docker/runner.ts'
import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ContainerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

// The images the `containers` job built and `deploy` downloaded.
export interface ContainerImageSource {
	readonly archiveDir: string
	// The tag they were built with: the commit SHA.
	readonly imageTag: string
}

export interface ContainerServiceDeploy {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly accountId: string
	readonly serviceName: string
	readonly service: ContainerServiceConfig
	// The gateway's public env, built like a Worker's.
	readonly vars: Readonly<Record<string, string>>
	readonly outputs: WorkersTerraformOutputs
	// The repository's Infisical secrets; undefined without a project.
	readonly projectSecrets: Readonly<Record<string, string>> | undefined
	readonly images: ContainerImageSource
	readonly wranglerRunner: WranglerRunner
	readonly dockerRunner: DockerRunner
	readonly projectDir: string
}

// Load the archive and push it. No caller code runs: `docker load` unpacks
// layers and `wrangler containers push` re-tags and uploads them. The reference
// is derived, then checked against what wrangler reports.
async function publishImage(job: ContainerServiceDeploy): Promise<string> {
	const localTag = computeContainerImageTag({
		projectName: job.projectName,
		environment: job.environment,
		serviceName: job.serviceName,
		imageTag: job.images.imageTag,
	})
	await loadContainerImage(
		join(job.images.archiveDir, containerImageArchiveName(job.serviceName)),
		job.dockerRunner,
	)
	const expected = computeContainerImageReference(job.accountId, localTag)
	const reported = await wranglerContainersPush(localTag, job.wranglerRunner)
	if (typeof reported === 'undefined') {
		logger.warn(`wrangler reported no pushed image; deploying ${expected}`)
		return expected
	}
	if (reported !== expected) {
		throw new Error(
			`wrangler pushed "${reported}" but the deploy expected "${expected}" - the registry naming changed; update computeContainerImageReference`,
		)
	}
	return expected
}

/**
 * Deploy one container service: push its image, deploy the gateway Worker with
 * the container application pointing at the pushed reference, then make the
 * gateway hold exactly the Infisical secrets plus the backing secrets. Wrangler
 * returns before the rollout ends; the smoke check absorbs a first boot.
 */
export async function deployContainerService(
	job: ContainerServiceDeploy,
): Promise<void> {
	const secrets = resolveContainerSecrets(
		job.projectSecrets,
		buildContainerBackingSecrets(job.service, job.outputs),
	)
	const image = await publishImage(job)
	const document = buildContainerWranglerConfig({
		projectName: job.projectName,
		environment: job.environment,
		serviceName: job.serviceName,
		service: job.service,
		vars: job.vars,
		gatewayEntry: resolveContainerGatewayEntry(),
		image,
	})
	await wranglerDeploy({
		document,
		runner: job.wranglerRunner,
		cwd: job.projectDir,
		...(secrets && { secrets }),
	})
}
