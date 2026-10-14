import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { hasProdGate } from '#/domain/pipeline/quality-matrix.ts'

import { writeOutput } from './output.ts'

import type { NextNodeConfig } from '#/config/types.ts'
import type { QualityTask } from '#/domain/pipeline/quality-matrix.ts'

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{
		id: 'skip',
		name: 'No quality checks',
		cmd: 'echo skipped',
		infra: false,
	},
]

interface PlanInput {
	readonly config: NextNodeConfig
	readonly tasks: ReadonlyArray<QualityTask>
	readonly packageDir: string
}

export function writePlanOutputs({
	config,
	tasks,
	packageDir,
}: PlanInput): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX
	const matrixJson = JSON.stringify(qualityMatrix)

	writeOutput('quality_matrix', matrixJson)
	writeOutput('project_name', config.project.name)
	writeOutput('project_type', config.project.type)
	writeOutput('project_filter', config.project.filter || '')
	writeOutput('publish', config.package ? 'true' : 'false')
	writeOutput('development_enabled', String(config.environment.development))
	writeOutput('has_prod_gate', String(hasProdGate(qualityMatrix)))
	writeOutput('has_domain', String(Boolean(config.project.domain)))
	writeOutput(
		'has_migrations',
		String(Boolean(config.services.d1 ?? config.services.planetscale)),
	)
	writeOutput('domain', config.project.domain ?? '')
	writeOutput('package_dir', packageDir)

	logger.info(`Quality matrix: ${matrixJson}`)
	logger.info('Plan outputs written to GITHUB_OUTPUT')
}
