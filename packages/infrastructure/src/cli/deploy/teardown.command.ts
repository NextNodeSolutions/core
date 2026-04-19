import { createLogger } from '@nextnode-solutions/logger'

import { writeSummary } from '../../adapters/github/output.ts'
import type { DeployableConfig } from '../../config/types.ts'
import { buildTeardownSummary } from '../../domain/deploy/teardown-summary.ts'
import { parseTeardownTarget } from '../../domain/deploy/teardown-target.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv } from '../env.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'

const logger = createLogger()

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const teardownTarget = parseTeardownTarget(getEnv('TEARDOWN_TARGET'))
	const target = await buildRuntimeTarget(config, environment)

	// Audit line — emitted BEFORE any destructive call so CI log readers can
	// reconstruct the exact scope of the teardown (project, env, target type,
	// domain) even if a later step fails mid-flight.
	logger.info(
		`Teardown starting: project="${config.project.name}" env="${environment}" target="${target.name}" scope="${teardownTarget}" domain="${config.project.domain ?? '(none)'}"`,
	)

	const result = await target.teardown(
		config.project.name,
		config.project.domain,
		teardownTarget,
	)

	writeSummary(buildTeardownSummary(result, config.project.name, target.name))
}
