import { resolve } from 'node:path'

import { writeWorkerTypes } from '#/adapters/cloudflare/workers/write-worker-types.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'
import { renderWorkerEnvTypes } from '#/domain/cloudflare/workers/worker-env-types.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { resolveConfigDir } from './config-dir.ts'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

/**
 * Generate a `worker-configuration.d.ts` for every Worker in a cloudflare-workers
 * project, replacing hand-written `env.d.ts` shims. Runs at typecheck/build time
 * (before `astro build`/`astro check`), NOT at deploy: the app's `import { env }
 * from 'cloudflare:workers'` must already be typed. A non-workers target is a
 * no-op (a Pages/VPS project has no worker `Env`).
 */
export function generateWorkerTypesCommand(config: DeployableConfig): void {
	if (!isCloudflareWorkersDeployableConfig(config)) {
		logger.info(
			'generate-worker-types is a no-op: target is not cloudflare-workers',
		)
		return
	}

	const configDir = resolveConfigDir()
	const serviceNames = Object.keys(config.deploy.services)

	for (const [serviceName, service] of Object.entries(
		config.deploy.services,
	)) {
		const content = renderWorkerEnvTypes({
			serviceName,
			service,
			services: config.services,
			serviceNames,
			secretNames: service.secrets,
		})
		writeWorkerTypes({
			entryPath: resolve(configDir, service.entry),
			content,
		})
	}

	logger.info(`Generated worker types for ${serviceNames.length} service(s)`)
}
