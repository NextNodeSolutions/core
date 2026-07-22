import { resolve } from 'node:path'

import { writeDevWranglerConfig } from '#/adapters/cloudflare/workers/write-dev-wrangler-config.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'
import { deriveWorkerAssetsDirectory } from '#/domain/cloudflare/workers/assets-directory.ts'
import { buildDevWranglerConfig } from '#/domain/cloudflare/workers/dev-wrangler-config.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { resolveConfigDir } from './config-dir.ts'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

/**
 * Generate a committed `wrangler.jsonc` for every plain (asset-less) Worker so
 * local `wrangler dev` pins the fleet `compatibility_date`/flags instead of
 * defaulting to today's date - which crashes the moment the calendar outruns the
 * installed workerd. Asset-bearing Workers (the @astrojs/cloudflare fronts) run
 * under `astro dev`, not wrangler, so they get no file. Runs at typecheck/build,
 * NOT at deploy (deploy passes its own ephemeral `--config`); CI regenerates +
 * `git diff --exit-code` guards drift, exactly like `generate-worker-types`. A
 * non-workers target is a no-op.
 */
export function generateDevConfigCommand(config: DeployableConfig): void {
	if (!isCloudflareWorkersDeployableConfig(config)) {
		logger.info(
			'generate-dev-config is a no-op: target is not cloudflare-workers',
		)
		return
	}

	const configDir = resolveConfigDir()
	const written: string[] = []

	for (const [serviceName, service] of Object.entries(
		config.deploy.services,
	)) {
		if (typeof deriveWorkerAssetsDirectory(service.entry) !== 'undefined') {
			continue
		}
		writeDevWranglerConfig({
			entryPath: resolve(configDir, service.entry),
			content: buildDevWranglerConfig({
				projectName: config.project.name,
				serviceName,
			}),
		})
		written.push(serviceName)
	}

	logger.info(`Generated dev wrangler config for ${written.length} worker(s)`)
}
