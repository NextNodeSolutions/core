import { createLogger } from '@nextnode-solutions/logger'

import { injectFiles } from '../../adapters/build-output/inject-files.ts'
import type { DeployableConfig } from '../../config/types.ts'
import { computeSeoGuardFiles } from '../../domain/deploy/seo-guard.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv, requireEnv } from '../env.ts'

const logger = createLogger()

export function seoGuardCommand(config: DeployableConfig): void {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	const files = computeSeoGuardFiles(environment)
	if (files.length === 0) {
		logger.info('Production build — no SEO guard needed')
		return
	}

	const buildDirectory = requireEnv('BUILD_DIRECTORY')
	injectFiles(buildDirectory, files)
	logger.info(`SEO guard applied for ${environment}`)
}
