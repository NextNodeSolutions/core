import { posix } from 'node:path'

import { containerServiceEntries } from './container-services.ts'
import { computeWorkerScriptName } from './worker-name.ts'

import type { DeployServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

// The managed registry `wrangler containers push` writes to; images are
// namespaced by account id inside it.
export const CLOUDFLARE_CONTAINER_REGISTRY = 'registry.cloudflare.com'

// The OCI tag grammar. The tag comes from the environment (the commit SHA in
// CI), so it is checked before Docker rejects it with a less helpful message.
export const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

const IMAGE_ARCHIVE_EXTENSION = '.tar'
const RELEASE_SEPARATOR = '+'

export interface ContainerImageName {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	readonly imageTag: string
}

/**
 * The local image tag of a container service: `<project>-<env>-<service>:<tag>`.
 * The repository is the Worker script name, so the registry image, the
 * container application and the gateway Worker share one name that teardown
 * finds them all by.
 */
export function computeContainerImageTag(image: ContainerImageName): string {
	if (!IMAGE_TAG_PATTERN.test(image.imageTag)) {
		throw new Error(
			`IMAGE_TAG "${image.imageTag}" is not a valid image tag (pattern: ${IMAGE_TAG_PATTERN.source}) - the workflow passes the commit SHA`,
		)
	}
	const repository = computeWorkerScriptName(
		image.projectName,
		image.environment,
		image.serviceName,
	)
	return `${repository}:${image.imageTag}`
}

/** The reference `wrangler containers push <localTag>` publishes. */
export function computeContainerImageReference(
	accountId: string,
	localTag: string,
): string {
	return `${CLOUDFLARE_CONTAINER_REGISTRY}/${accountId}/${localTag}`
}

/** The image archive of one service, inside the images directory. */
export function containerImageArchiveName(serviceName: string): string {
	return `${serviceName}${IMAGE_ARCHIVE_EXTENSION}`
}

/**
 * The release a deploy ships, which the gateway's health check answers with:
 * the image tag alone identifies the commit, and the workflow run suffix
 * tells a re-run of the same commit from the previous one.
 */
export function computeContainerRelease(
	imageTag: string,
	deployId: string | undefined,
): string {
	if (!deployId) return imageTag
	return `${imageTag}${RELEASE_SEPARATOR}${deployId}`
}

export function dockerLoadArgs(archivePath: string): ReadonlyArray<string> {
	return ['load', '-i', archivePath]
}

// One entry of the `containers` job matrix: what the Docker build action
// needs, as paths relative to the workflow's workspace.
export interface ContainerBuild {
	readonly service: string
	// `<project>-<env>-<service>`: the image repository and the cache scope.
	readonly repository: string
	readonly dockerfile: string
	readonly context: string
	readonly archive: string
}

/**
 * The images the `containers` job builds, one matrix entry per container
 * service. `image` and `context` are relative to nextnode.toml, which sits in
 * `packageDir` relative to the workspace.
 */
export function planContainerBuilds(
	services: Readonly<Record<string, DeployServiceConfig>>,
	image: Omit<ContainerImageName, 'serviceName' | 'imageTag'>,
	packageDir: string,
): ReadonlyArray<ContainerBuild> {
	return containerServiceEntries(services).map(([service, config]) => ({
		service,
		repository: computeWorkerScriptName(
			image.projectName,
			image.environment,
			service,
		),
		dockerfile: posix.join(packageDir, config.image),
		context: posix.join(packageDir, config.context),
		archive: containerImageArchiveName(service),
	}))
}
