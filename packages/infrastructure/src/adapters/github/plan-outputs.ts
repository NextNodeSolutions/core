import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { APP_SERVICE_NAME } from '#/domain/deploy/image-ref.ts'
import { hasProdGate } from '#/domain/pipeline/quality-matrix.ts'

import { writeOutput } from './output.ts'

import type { NextNodeConfig } from '#/config/types.ts'
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

	const { source, ref } = resolveImageOutputs(config)
	writeOutput('image_source', source)
	writeOutput('upstream_image_ref', ref)

	logger.info(`Quality matrix: ${matrixJson}`)
	logger.info('Plan outputs written to GITHUB_OUTPUT')
}

function resolveImageOutputs(config: NextNodeConfig): {
	readonly source: string
	readonly ref: string
} {
	if (config.deploy === false) return { source: '', ref: '' }
	if (config.deploy.target !== 'hetzner-vps') return { source: '', ref: '' }
	const service = config.deploy.services[APP_SERVICE_NAME]
	if (service === undefined) return { source: '', ref: '' }
	if (service.source === 'upstream')
		return { source: 'upstream', ref: service.ref }
	return { source: 'build', ref: '' }
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
