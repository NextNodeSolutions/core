import { join } from 'node:path'

import { writeBakeFile } from '#/adapters/build-output/bake-file.ts'
import { writeOutput } from '#/adapters/github/output.ts'
import { requireEnv } from '#/cli/env.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { renderBakeFile } from '#/domain/deploy/bake-file.ts'
import { resolveServiceImageRefs } from '#/domain/deploy/image-ref.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

// Written at the workspace root and emitted by basename as the `bake_file`
// output the build job feeds to `docker/bake-action`'s `files:` input. The
// build step runs Bake with `source: .` so it executes from the workspace —
// making this a relative lookup and resolving each target's `context: "."`
// against the repo root.
const BAKE_FILE_NAME = 'docker-bake.json'

/**
 * Render the docker-bake definition from `nextnode.toml` and write it to the
 * workspace root, then publish the per-service `image_refs` the deploy +
 * migrate jobs consume. `nextnode.toml` is the single source of truth for
 * build shape: the caller ships no docker-compose.yml.
 */
export function computeImageRefCommand(config: DeployableConfig): void {
	if (!isHetznerDeployableConfig(config)) {
		throw new Error(
			'compute-image-ref requires a hetzner-vps deploy target — non-container targets build no images',
		)
	}

	const repository = requireEnv('GITHUB_REPOSITORY')
	const sha = requireEnv('GITHUB_SHA')
	const packageDir = requireEnv('PACKAGE_DIR')
	const workspace = requireEnv('GITHUB_WORKSPACE')

	const { imageRefs, bakeTargets } = resolveServiceImageRefs(
		config.deploy.services,
		repository,
		sha,
	)

	const bakeDefinition = renderBakeFile({
		services: config.deploy.services,
		imageRefs,
		bakeTargets,
		packageDir,
	})
	writeBakeFile(join(workspace, BAKE_FILE_NAME), bakeDefinition)

	const imageRefsJson = JSON.stringify(imageRefs)
	writeOutput('image_refs', imageRefsJson)
	writeOutput('bake_file', BAKE_FILE_NAME)
	logger.info(`image_refs=${imageRefsJson}`)
	logger.info(`bake_file=${BAKE_FILE_NAME}`)
}
