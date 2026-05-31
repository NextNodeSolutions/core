import { writeMultilineOutput, writeOutput } from '#/adapters/github/output.ts'
import { requireEnv } from '#/cli/env.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { resolveServiceImageRefs } from '#/domain/deploy/image-ref.ts'
import { formatImageRef } from '#/domain/hetzner/compose-file.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'

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
	const bakeSet = formatBakeSet(imageRefs, bakeTargets)
	writeOutput('bake_targets', bakeTargetsCsv)
	writeOutput('image_refs', imageRefsJson)
	writeMultilineOutput('bake_set', bakeSet)
	logger.info(`bake_targets=${bakeTargetsCsv}`)
	logger.info(`image_refs=${imageRefsJson}`)
	logger.info(`bake_set=${bakeSet}`)

	// Legacy single-image output, kept additively until M1.A-05 drops it. It
	// mirrors the first declared service's ref (the single `app` during the
	// migration); deploy.yml itself already consumes IMAGE_REFS as of M1.A-04.
	if (!primaryRef) return
	const legacyRef = formatImageRef(primaryRef)
	writeOutput('image_ref', legacyRef)
	logger.info(`image_ref=${legacyRef}`)
}

/**
 * Render the multi-line `set:` value docker/bake-action consumes — one
 * `<target>.tags` line per build service plus its GHA layer-cache scope. Built
 * here (not in YAML) so the workflow stays free of per-target string logic, and
 * generated from the same `imageRefs` Record the deploy jobs read. Upstream
 * services never appear: they are not in `bakeTargets`.
 */
function formatBakeSet(
	imageRefs: Record<string, ImageRef>,
	bakeTargets: ReadonlyArray<string>,
): string {
	return bakeTargets
		.map(target => {
			const ref = imageRefs[target]
			if (!ref) {
				throw new Error(
					`bake target "${target}" has no resolved image ref`,
				)
			}
			return [
				`${target}.tags=${formatImageRef(ref)}`,
				`${target}.cache-from=type=gha,scope=${target}`,
				`${target}.cache-to=type=gha,scope=${target},mode=max`,
			].join('\n')
		})
		.join('\n')
}
