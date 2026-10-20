import { generateWorkerTypes } from '#/cli/deploy/worker-types.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { requireConfigDir } from './config-dir.ts'

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
	const written = generateWorkerTypes(config, requireConfigDir())
	if (!written.length) {
		logger.info(
			'generate-worker-types is a no-op: target is not cloudflare-workers',
		)
		return
	}
	logger.info(`Generated worker types for ${written.length} service(s)`)
}
