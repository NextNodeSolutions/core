import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { parseImageRef } from '#/domain/deploy/image-ref.ts'
import { hasProdGate } from '#/domain/pipeline/quality-matrix.ts'

import { writeOutput } from './output.ts'

import type { NextNodeConfig } from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { QualityTask } from '#/domain/pipeline/quality-matrix.ts'

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{ id: 'skip', name: 'No quality checks', cmd: 'echo skipped' },
]

interface PlanInput {
	readonly config: NextNodeConfig
	readonly pagesProjectName: string
	readonly tasks: ReadonlyArray<QualityTask>
	readonly buildDirectory: string
	readonly packageDir: string
}

export function writePlanOutputs({
	config,
	pagesProjectName,
	tasks,
	buildDirectory,
	packageDir,
}: PlanInput): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX
	const matrixJson = JSON.stringify(qualityMatrix)

	writeOutput('quality_matrix', matrixJson)
	writeOutput('project_name', pagesProjectName)
	writeOutput('project_type', config.project.type)
	writeOutput('project_filter', config.project.filter || '')
	writeOutput('publish', config.package ? 'true' : 'false')
	writeOutput('development_enabled', String(config.environment.development))
	writeOutput('has_prod_gate', String(hasProdGate(qualityMatrix)))
	writeOutput('has_domain', String(Boolean(config.project.domain)))
	writeOutput('has_postgres', String(hasPostgres(config)))
	writeOutput('domain', config.project.domain ?? '')
	writeOutput('build_directory', buildDirectory)
	writeOutput('package_dir', packageDir)

	const { source, imageRefs } = resolveImageOutputs(config)
	writeOutput('image_source', source)
	writeOutput('upstream_image_refs', imageRefs)

	logger.info(`Quality matrix: ${matrixJson}`)
	logger.info('Plan outputs written to GITHUB_OUTPUT')
}

// The upstream IMAGE_REFS the deploy + migrate jobs fall back to when no image
// is built. Emitted as the SAME JSON shape `compute-image-ref` produces for
// built services (`{ <service>: { registry, repository, tag } }`) so
// `parseImageRefsEnv` consumes both paths identically — the bare ref string the
// old `image_ref` carried is not valid JSON and broke the upstream deploy.
// Parsing each declared ref here also fails a malformed upstream ref loudly at
// plan time, not as a broken `docker pull` on the VPS.
//
// Mixed sources are rejected at config validation, so the declared services are
// homogeneous: either every service is `upstream` — emit one ref per service so
// the deploy/migrate jobs pull them all — or every service is `build`, in which
// case the build-image job supplies `image_refs` and there is nothing to emit.
function resolveImageOutputs(config: NextNodeConfig): {
	readonly source: string
	readonly imageRefs: string
} {
	if (config.deploy === false) return { source: '', imageRefs: '' }
	if (config.deploy.target !== 'hetzner-vps')
		return { source: '', imageRefs: '' }

	const upstreamRefs: Record<string, ImageRef> = {}
	for (const [name, service] of Object.entries(config.deploy.services)) {
		if (service.source !== 'upstream') continue
		upstreamRefs[name] = parseImageRef(service.ref)
	}

	if (Object.keys(upstreamRefs).length === 0) {
		return { source: 'build', imageRefs: '' }
	}
	return { source: 'upstream', imageRefs: JSON.stringify(upstreamRefs) }
}

/**
 * Whether the project declares `[services.postgres]`. Drives the `if:`
 * on the `migrate` job in `deploy.yml`: postgres-less projects skip
 * the migrate step entirely so the cost of Path A is only paid when
 * there is actually a schema to migrate.
 */
function hasPostgres(config: NextNodeConfig): boolean {
	return Boolean(config.services.postgres)
}
