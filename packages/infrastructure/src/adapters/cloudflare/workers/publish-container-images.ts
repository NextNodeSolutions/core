import { join } from 'node:path'

import { createRegistryCredentials } from '#/adapters/cloudflare/containers/registry.ts'
import {
	defaultSkopeoRunner,
	pushImageArchive,
} from '#/adapters/skopeo/push.ts'
import {
	computeContainerImageReference,
	computeContainerImageTag,
	containerImageArchiveName,
} from '#/domain/cloudflare/workers/container-image.ts'
import { containerServiceEntries } from '#/domain/cloudflare/workers/container-services.ts'

import { planContainerImagePrune } from './prune-container-images.ts'

import type { CloudflareApiAccess } from '#/adapters/cloudflare/api.ts'
import type { RegistryCredentials } from '#/adapters/cloudflare/containers/registry.ts'
import type { SkopeoRunner } from '#/adapters/skopeo/push.ts'
import type { DeployServiceConfig } from '#/config/types.ts'
import type { ImagePrunePlan } from '#/domain/cloudflare/workers/container-image-prune.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export type { CloudflareApiAccess }

// The images the `containers` job built and `deploy` downloaded.
export interface ContainerImageSource {
	readonly archiveDir: string
	// The tag they were built with: the commit SHA.
	readonly imageTag: string
	// The release the gateway answers the health check with: the tag, and the
	// workflow run when CI names one.
	readonly release: string
}

export interface ContainerImagePublishInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly accountId: string
	readonly services: Readonly<Record<string, DeployServiceConfig>>
	readonly images: ContainerImageSource
	readonly cloudflareApi: CloudflareApiAccess
	readonly skopeoRunner?: SkopeoRunner | undefined
}

// What the deploy of the container services needs once the push is done.
export interface PublishedContainerImages {
	readonly release: string
	// The pushed reference of each container service's image.
	readonly references: Readonly<Record<string, string>>
	// The prune that follows the deploy, planned before the push.
	readonly prunePlans: ReadonlyArray<ImagePrunePlan>
}

async function pushService(
	input: ContainerImagePublishInput,
	serviceName: string,
	credentials: RegistryCredentials,
): Promise<readonly [string, string]> {
	const reference = computeContainerImageReference(
		input.accountId,
		computeContainerImageTag({
			projectName: input.projectName,
			environment: input.environment,
			serviceName,
			imageTag: input.images.imageTag,
		}),
	)
	await pushImageArchive(
		{
			archive: join(
				input.images.archiveDir,
				containerImageArchiveName(serviceName),
			),
			reference,
		},
		credentials,
		input.skopeoRunner ?? defaultSkopeoRunner,
	)
	return [serviceName, reference]
}

/**
 * Push every container service's saved image to the account's registry and
 * plan the prune that follows the deploy. No caller code runs: the archives
 * are uploaded as they are. Needs no provision output, so the deploy starts
 * it while those are read, and awaits it before the first container service
 * deploys.
 */
export async function publishContainerImages(
	input: ContainerImagePublishInput,
): Promise<PublishedContainerImages> {
	const [credentials, prunePlans] = await Promise.all([
		createRegistryCredentials(input.cloudflareApi),
		planContainerImagePrune({
			projectName: input.projectName,
			environment: input.environment,
			services: input.services,
			deployedTag: input.images.imageTag,
			cloudflareApi: input.cloudflareApi,
		}),
	])
	const references = await Promise.all(
		containerServiceEntries(input.services).map(([serviceName]) =>
			pushService(input, serviceName, credentials),
		),
	)
	return {
		release: input.images.release,
		references: Object.fromEntries(references),
		prunePlans,
	}
}
