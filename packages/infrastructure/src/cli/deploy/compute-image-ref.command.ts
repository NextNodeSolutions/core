import { writeOutput } from '#/adapters/github/output.ts'
import { requireEnv } from '#/cli/env.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { resolveServiceImageRefs } from '#/domain/deploy/image-ref.ts'
import { formatImageRef } from '#/domain/hetzner/compose-file.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

export function computeImageRefCommand(config: DeployableConfig): void {
	if (!isHetznerDeployableConfig(config)) {
		throw new Error(
			'compute-image-ref requires a hetzner-vps deploy target — non-container targets build no images',
		)
	}

	const repository = requireEnv('GITHUB_REPOSITORY')
	const sha = requireEnv('GITHUB_SHA')

	const { imageRefs, bakeTargets, primaryRef } = resolveServiceImageRefs(
		config.deploy.services,
		repository,
		sha,
	)

	const bakeTargetsCsv = bakeTargets.join(',')
	const imageRefsJson = JSON.stringify(imageRefs)
	writeOutput('bake_targets', bakeTargetsCsv)
	writeOutput('image_refs', imageRefsJson)
	logger.info(`bake_targets=${bakeTargetsCsv}`)
	logger.info(`image_refs=${imageRefsJson}`)

	// Legacy single-image output, kept additively until M1.A-04 switches
	// deploy.yml over to IMAGE_REFS; dropped in M1.A-05. It mirrors the
	// first declared service's ref (the single `app` during the migration).
	if (!primaryRef) return
	const legacyRef = formatImageRef(primaryRef)
	writeOutput('image_ref', legacyRef)
	logger.info(`image_ref=${legacyRef}`)
}
