import { hasContainerService } from '#/domain/cloudflare/workers/container-services.ts'

import { publishContainerImages } from './publish-container-images.ts'

import type { CloudflareApiAccess } from '#/adapters/cloudflare/api.ts'
import type { DeployServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	ContainerImageSource,
	PublishedContainerImages,
} from './publish-container-images.ts'

export type { ContainerImageSource }

export interface ContainerPublishContext {
	readonly environment: AppEnvironment
	readonly accountId: string
	readonly services: Readonly<Record<string, DeployServiceConfig>>
	readonly cloudflareApi: CloudflareApiAccess
	// The images the `containers` job built; set only in the deploy job.
	readonly images: ContainerImageSource | undefined
}

// The push of one deploy; undefined for a project without a container
// service.
export type ContainerPublish = (
	projectName: string,
) => Promise<PublishedContainerImages> | undefined

// Awaits a promise another step awaits later, so that its rejection is
// handled there and not reported as unhandled before.
async function settle(promise: Promise<unknown>): Promise<void> {
	try {
		await promise
	} catch {
		// Reported where the promise is awaited for its value.
	}
}

/**
 * The push of one deploy, started by the first call and shared with the
 * next: `prepareDeploy` starts it while the backing env is read, `deploy`
 * awaits it. Without images (a job that downloaded none) the call throws,
 * naming what the deploy job sets.
 */
export function createContainerPublish(
	context: ContainerPublishContext,
): ContainerPublish {
	let started: Promise<PublishedContainerImages> | undefined
	return projectName => {
		if (!hasContainerService(context.services)) return undefined
		if (started) return started
		const { images } = context
		if (!images) {
			throw new Error(
				"a container service needs its built images, but no image directory was given - the deploy job sets CONTAINER_IMAGES_DIR and IMAGE_TAG after downloading the `containers` job's artifact",
			)
		}
		started = publishContainerImages({ ...context, projectName, images })
		void settle(started)
		return started
	}
}
