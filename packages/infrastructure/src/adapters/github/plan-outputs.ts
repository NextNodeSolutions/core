import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { planContainerBuilds } from '#/domain/cloudflare/workers/container-image.ts'
import {
	hasMigrations,
	planetscaleMigrateCommand,
} from '#/domain/deploy/migrations.ts'
import { isAppEnvironment } from '#/domain/environment.ts'
import { hasProdGate } from '#/domain/pipeline/quality-matrix.ts'

import { writeOutput } from './output.ts'

import type { NextNodeConfig } from '#/config/types.ts'
import type { ContainerBuild } from '#/domain/cloudflare/workers/container-image.ts'
import type { PipelineEnvironment } from '#/domain/environment.ts'
import type { QualityTask } from '#/domain/pipeline/quality-matrix.ts'

const SKIP_MATRIX: ReadonlyArray<QualityTask> = [
	{
		id: 'skip',
		name: 'No quality checks',
		cmd: 'echo skipped',
	},
]

interface PlanInput {
	readonly config: NextNodeConfig
	readonly environment: PipelineEnvironment
	readonly tasks: ReadonlyArray<QualityTask>
	readonly packageDir: string
	// File name of nextnode.toml inside `packageDir` - the deploy job reads it
	// from the build artifact, laid out like the package directory.
	readonly configName: string
}

// A container service's image is built by the `containers` job, one matrix
// entry per service, with no credential. A project that deploys nothing has
// no entry.
function containerBuilds(
	config: NextNodeConfig,
	environment: PipelineEnvironment,
	packageDir: string,
): ReadonlyArray<ContainerBuild> {
	if (!config.deploy || !isAppEnvironment(environment)) return []
	return planContainerBuilds(
		config.deploy.services,
		{ projectName: config.project.name, environment },
		packageDir,
	)
}

export function writePlanOutputs({
	config,
	environment,
	tasks,
	packageDir,
	configName,
}: PlanInput): void {
	const qualityMatrix = tasks.length > 0 ? tasks : SKIP_MATRIX
	const matrixJson = JSON.stringify(qualityMatrix)
	const containers = containerBuilds(config, environment, packageDir)

	writeOutput('quality_matrix', matrixJson)
	writeOutput('project_name', config.project.name)
	writeOutput('project_type', config.project.type)
	writeOutput('project_filter', config.project.filter || '')
	writeOutput('publish', config.package ? 'true' : 'false')
	writeOutput('development_enabled', String(config.environment.development))
	writeOutput(
		'has_prod_gate',
		String(
			hasProdGate({
				environment,
				developmentEnabled: config.environment.development,
			}),
		),
	)
	writeOutput('has_domain', String(Boolean(config.project.domain)))
	writeOutput('has_migrations', String(hasMigrations(config.services)))
	// A PlanetScale migration runs the project's own migrate command, so the
	// migrate job installs the project's dependencies only in that case.
	writeOutput(
		'has_planetscale_migration',
		String(Boolean(planetscaleMigrateCommand(config.services))),
	)
	writeOutput('has_containers', String(containers.length > 0))
	writeOutput('containers_matrix', JSON.stringify(containers))
	writeOutput('domain', config.project.domain ?? '')
	writeOutput('package_dir', packageDir)
	writeOutput('config_name', configName)

	logger.info(`Quality matrix: ${matrixJson}`)
	logger.info('Plan outputs written to GITHUB_OUTPUT')
}
