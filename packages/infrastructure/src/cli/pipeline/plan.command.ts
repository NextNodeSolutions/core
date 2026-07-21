import { dirname, join, relative } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writePlanOutputs } from '#/adapters/github/plan-outputs.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { isDeployable } from '#/config/types.ts'
import { computePagesProjectName } from '#/domain/cloudflare/pages-project-name.ts'
import { computeWorkersBuildDirectory } from '#/domain/cloudflare/workers/assets-directory.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { buildQualityMatrix } from '#/domain/pipeline/quality-matrix.ts'

import type { NextNodeConfig } from '#/config/types.ts'

const PROD_GATE_COMMAND =
	'cd .infra/packages/infrastructure && node src/index.ts prod-gate'

const DEFAULT_DRIZZLE_CHECK_COMMAND = 'pnpm drizzle-kit check'

const DEFAULT_BUILD_OUTPUT = 'dist'

export function planCommand(config: NextNodeConfig): void {
	const { type } = config.project
	const rawEnv = getEnv('PIPELINE_ENVIRONMENT')
	const environment = isDeployable(type)
		? resolveEnvironment(type, rawEnv)
		: resolveEnvironment(type, rawEnv)

	const pagesProjectName = computePagesProjectName(
		config.project.name,
		environment,
	)

	const packageDir = computePackageDir()
	const buildDirectory = resolveBuildDirectory(config, packageDir)

	logger.info(`Project: ${config.project.name}`)
	logger.info(`Environment: ${environment}`)
	logger.info(`Pages project: ${pagesProjectName}`)
	logger.info(`Package dir: ${packageDir}`)
	logger.info(`Build directory: ${buildDirectory}`)

	const { postgres } = config.services
	const tasks = buildQualityMatrix(config.scripts, config.project, {
		environment,
		developmentEnabled: config.environment.development,
		prodGateCommand: PROD_GATE_COMMAND,
		...(postgres && {
			drizzleCheckCommand:
				postgres.checkCommand ?? DEFAULT_DRIZZLE_CHECK_COMMAND,
		}),
	})
	writePlanOutputs({
		config,
		pagesProjectName,
		tasks,
		buildDirectory,
		packageDir,
	})
}

function computePackageDir(): string {
	const configFilePath = requireEnv('PIPELINE_CONFIG_FILE')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	return relative(workspace, dirname(configFilePath))
}

// A cloudflare-workers deploy serves `_headers`/`robots.txt` (the SEO guard)
// from the primary routed service's static-assets directory, not the fixed
// `dist`; an assets-less API Worker yields an empty directory so the CI SEO
// step is skipped. Every other target keeps the conventional build output.
function resolveBuildDirectory(
	config: NextNodeConfig,
	packageDir: string,
): string {
	if (
		config.deploy !== false &&
		config.deploy.target === 'cloudflare-workers'
	) {
		const assetsDir = computeWorkersBuildDirectory(config.deploy.services)
		return assetsDir === '' ? '' : join(packageDir, assetsDir)
	}
	return join(packageDir, DEFAULT_BUILD_OUTPUT)
}
