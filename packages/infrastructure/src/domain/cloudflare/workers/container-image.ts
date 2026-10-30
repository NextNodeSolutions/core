import { computeWorkerScriptName } from './worker-name.ts'

import type { AppEnvironment } from '#/domain/environment.ts'

// The managed registry `wrangler containers push` writes to; images are
// namespaced by account id inside it.
export const CLOUDFLARE_CONTAINER_REGISTRY = 'registry.cloudflare.com'

// The only platform Cloudflare Containers run.
export const CONTAINER_IMAGE_PLATFORM = 'linux/amd64'

// The OCI tag grammar. The tag comes from the environment (the commit SHA in
// CI), so it is checked before Docker rejects it with a less helpful message.
export const IMAGE_TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/

const IMAGE_ARCHIVE_EXTENSION = '.tar'

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

/** The `docker save` archive of one service, inside the images directory. */
export function containerImageArchiveName(serviceName: string): string {
	return `${serviceName}${IMAGE_ARCHIVE_EXTENSION}`
}

export interface DockerBuildInput {
	// Absolute paths: docker runs from core's checkout, not the project.
	readonly dockerfile: string
	readonly context: string
	readonly tag: string
}

// What wrangler itself runs to build a container image: `--load` keeps the
// image in the local store whatever the builder driver, and
// `--provenance=false` keeps the manifest a single-platform image.
export function dockerBuildArgs(
	input: DockerBuildInput,
): ReadonlyArray<string> {
	return [
		'build',
		'--load',
		'--platform',
		CONTAINER_IMAGE_PLATFORM,
		'--provenance=false',
		'-f',
		input.dockerfile,
		'-t',
		input.tag,
		input.context,
	]
}

export function dockerSaveArgs(
	archivePath: string,
	tag: string,
): ReadonlyArray<string> {
	return ['save', '-o', archivePath, tag]
}

export function dockerLoadArgs(archivePath: string): ReadonlyArray<string> {
	return ['load', '-i', archivePath]
}
