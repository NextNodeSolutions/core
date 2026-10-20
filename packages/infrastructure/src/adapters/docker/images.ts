import { existsSync } from 'node:fs'

import { dockerLoadArgs } from '#/domain/cloudflare/workers/container-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { runDocker } from './runner.ts'

import type { DockerRunner } from './runner.ts'

const logger = createLogger()

/** Load an image archive the `containers` job built into the local store. */
export async function loadContainerImage(
	archivePath: string,
	runner: DockerRunner,
): Promise<void> {
	if (!existsSync(archivePath)) {
		throw new Error(
			`No container image archive at ${archivePath} - the \`containers\` job builds it and \`deploy\` downloads its artifacts into CONTAINER_IMAGES_DIR`,
		)
	}
	const exec = await runDocker(dockerLoadArgs(archivePath), runner)
	logger.info(exec.stdout.trim())
}
