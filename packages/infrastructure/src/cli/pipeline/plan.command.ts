import { dirname, relative } from 'node:path'

import { writePlanOutputs } from '#/adapters/github/plan-outputs.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { buildQualityMatrix } from '#/domain/pipeline/quality-matrix.ts'

import type { NextNodeConfig } from '#/config/types.ts'

const PROD_GATE_COMMAND =
	'cd .infra/packages/infrastructure && node src/index.ts prod-gate'

export function planCommand(config: NextNodeConfig): void {
	const environment =
		config.project.type === 'package'
			? 'production'
			: resolveEnvironment(
					config.project.type,
					getEnv('PIPELINE_ENVIRONMENT'),
				)
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const packageDir = relative(
		workspace,
		dirname(requireEnv('PIPELINE_CONFIG_FILE')),
	)
	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
		...(config.services.d1?.checkCommand && {
			drizzleCheckCommand: config.services.d1.checkCommand,
		}),
	})
	writePlanOutputs({ config, tasks, packageDir })
}
