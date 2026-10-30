import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import {
	dockerBuildArgs,
	dockerLoadArgs,
	dockerSaveArgs,
} from '#/domain/cloudflare/workers/container-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { runDocker } from './runner.ts'

import type { DockerBuildInput } from '#/domain/cloudflare/workers/container-image.ts'
import type { DockerRunner } from './runner.ts'

const logger = createLogger()

export interface ContainerImageBuild extends DockerBuildInput {
	// Where `docker save` writes the image, for the job that pushes it.
	readonly archivePath: string
}

/**
 * Build one container image from the project's Dockerfile and save it to an
 * archive, creating the archive's directory. Runs the caller's Dockerfile, so
 * only a job without credentials calls it.
 */
export async function buildContainerImage(
	build: ContainerImageBuild,
	runner: DockerRunner,
): Promise<void> {
	if (!existsSync(build.dockerfile)) {
		throw new Error(
			`No Dockerfile at ${build.dockerfile} for image "${build.tag}" - a container service's \`image\` is relative to nextnode.toml`,
		)
	}
	mkdirSync(dirname(build.archivePath), { recursive: true })
	logger.info(`docker build "${build.tag}" from ${build.dockerfile}`)
	await runDocker(dockerBuildArgs(build), runner)
	await runDocker(dockerSaveArgs(build.archivePath, build.tag), runner)
	logger.info(`Saved "${build.tag}" to ${build.archivePath}`)
}

/** Load an image archive built by `buildContainerImage` into the local store. */
export async function loadContainerImage(
	archivePath: string,
	runner: DockerRunner,
): Promise<void> {
	if (!existsSync(archivePath)) {
		throw new Error(
			`No container image archive at ${archivePath} - the \`containers\` job builds it and \`deploy\` downloads its artifact into CONTAINER_IMAGES_DIR`,
		)
	}
	const exec = await runDocker(dockerLoadArgs(archivePath), runner)
	logger.info(exec.stdout.trim())
}
