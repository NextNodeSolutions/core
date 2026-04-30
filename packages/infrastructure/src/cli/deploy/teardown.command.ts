import { writeSummary } from '#/adapters/github/output.ts'
import { getEnv } from '#/cli/env.ts'
import type { DeployableConfig } from '#/config/types.ts'
import { buildTeardownSummary } from '#/domain/deploy/teardown-summary.ts'
import {
	parseTeardownTarget,
	parseTeardownWithVolumes,
	validateTeardownOptions,
} from '#/domain/deploy/teardown-target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'

const logger = createLogger()

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const teardownTarget = parseTeardownTarget(getEnv('TEARDOWN_TARGET'))
	const withVolumes = parseTeardownWithVolumes(
		getEnv('TEARDOWN_WITH_VOLUMES'),
	)
	validateTeardownOptions(config.project.type, teardownTarget, withVolumes)
	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	// Audit line — emitted BEFORE any destructive call so CI log readers can
	// reconstruct the exact scope of the teardown (project, env, target type,
	// domain) even if a later step fails mid-flight.
	logger.info(
		`Teardown starting: project="${config.project.name}" env="${environment}" target="${target.name}" scope="${teardownTarget}" withVolumes=${String(withVolumes)} domain="${config.project.domain ?? '(none)'}"`,
	)

	const result = await target.teardown(
		config.project.name,
		config.project.domain,
		teardownTarget,
		withVolumes,
	)

	writeSummary(buildTeardownSummary(result, config.project.name, target.name))
}
