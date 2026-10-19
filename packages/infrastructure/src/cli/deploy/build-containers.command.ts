import { join, resolve } from 'node:path'

import { buildContainerImage } from '#/adapters/docker/images.ts'
import { defaultDockerRunner } from '#/adapters/docker/runner.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import {
	computeContainerImageTag,
	containerImageArchiveName,
} from '#/domain/cloudflare/workers/container-image.ts'
import { containerServiceEntries } from '#/domain/cloudflare/workers/container-services.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { requireConfigDir } from './config-dir.ts'

import type { ContainerImageBuild } from '#/adapters/docker/images.ts'
import type {
	ContainerServiceConfig,
	DeployableConfig,
} from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

interface ImageBuildContext {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly configDir: string
	readonly archiveDir: string
	readonly imageTag: string
}

// `image` and `context` are relative to nextnode.toml; docker gets absolute
// paths because it runs from core's checkout.
function imageBuild(
	context: ImageBuildContext,
	serviceName: string,
	service: ContainerServiceConfig,
): ContainerImageBuild {
	return {
		dockerfile: resolve(context.configDir, service.image),
		context: resolve(context.configDir, service.context),
		tag: computeContainerImageTag({
			projectName: context.projectName,
			environment: context.environment,
			serviceName,
			imageTag: context.imageTag,
		}),
		archivePath: join(
			context.archiveDir,
			containerImageArchiveName(serviceName),
		),
	}
}

/**
 * Build every container service's image and save each to an archive in
 * CONTAINER_IMAGES_DIR, for the deploy job to load and push. This runs the
 * caller's Dockerfile, so it runs only in the `containers` job, which holds no
 * credential and cannot mint one. Pushing needs the Cloudflare token and
 * happens in `deploy`, which never builds.
 */
export async function buildContainersCommand(
	config: DeployableConfig,
): Promise<void> {
	const containers = containerServiceEntries(config.deploy.services)
	if (!containers.length) {
		logger.info('build-containers is a no-op: no container service')
		return
	}
	const context: ImageBuildContext = {
		projectName: config.project.name,
		environment: resolveEnvironment(
			config.project.type,
			getEnv('PIPELINE_ENVIRONMENT'),
		),
		configDir: requireConfigDir(),
		archiveDir: requireEnv('CONTAINER_IMAGES_DIR'),
		imageTag: requireEnv('IMAGE_TAG'),
	}
	for (const [serviceName, service] of containers) {
		// eslint-disable-next-line no-await-in-loop -- one build at a time keeps the runner's disk and the log readable
		await buildContainerImage(
			imageBuild(context, serviceName, service),
			defaultDockerRunner,
		)
	}
	logger.info(`Built ${containers.length} container image(s)`)
}
