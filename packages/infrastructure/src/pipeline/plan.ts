import { logger } from '@nextnode-solutions/logger'

import type { NextNodeConfig } from '../config/schema.js'
import { writeOutput } from '../github/output.js'

import { hasProdGate } from './quality.js'
import type { QualityTask } from './quality.js'

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{ id: 'skip', name: 'No quality checks', cmd: 'echo skipped' },
]

interface PlanInput {
	readonly config: NextNodeConfig
	readonly tasks: ReadonlyArray<QualityTask>
}

export function writePlanOutputs({ config, tasks }: PlanInput): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX
	const matrixJson = JSON.stringify(qualityMatrix)

	writeOutput('quality_matrix', matrixJson)
	writeOutput('project_name', config.project.name)
	writeOutput('project_type', config.project.type)
	writeOutput('project_filter', config.project.filter || '')
	writeOutput('publish', config.package ? 'true' : 'false')
	writeOutput('development_enabled', String(config.environment.development))
	writeOutput('has_prod_gate', String(hasProdGate(qualityMatrix)))

	logger.info(`Quality matrix: ${matrixJson}`)
	logger.info('Plan outputs written to GITHUB_OUTPUT')
}
