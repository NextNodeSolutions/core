import { writeSummary } from '#/adapters/github/output.ts'
import { getEnv, isEnvSet } from '#/cli/env.ts'
import { assertWipeDataAllowed } from '#/domain/cloudflare/workers/teardown.ts'
import { buildTeardownSummary } from '#/domain/deploy/teardown-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	assertWipeDataAllowed(
		config.project.name,
		config.services,
		isEnvSet('TEARDOWN_WIPE_DATA'),
	)
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	const teardown = await target.teardown(config.project.name)
	writeSummary(
		buildTeardownSummary(teardown, config.project.name, target.name),
	)
}
