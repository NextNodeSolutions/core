import { isAbsolute, resolve } from 'node:path'

import { generateWorkerTypes } from '#/cli/deploy/worker-types.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

// The dir the workers' `entry` paths resolve against - the dir holding the
// nextnode.toml. Mirrors the deploy target's project-dir mechanism
// (PIPELINE_CONFIG_FILE against GITHUB_WORKSPACE) but is REQUIRED here: type
// generation always writes, so a missing config path is a hard error.
function resolveConfigDir(): string {
	const configFile = requireEnv('PIPELINE_CONFIG_FILE')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const absoluteConfig = isAbsolute(configFile)
		? configFile
		: resolve(workspace, configFile)
	return resolve(absoluteConfig, '..')
}

/**
 * Generate a `worker-configuration.d.ts` for every Worker in a cloudflare-workers
 * project, replacing hand-written `env.d.ts` shims. Runs at typecheck/build time
 * (before `astro build`/`astro check`), NOT at deploy: the app's `import { env }
 * from 'cloudflare:workers'` must already be typed. A non-workers target is a
 * no-op (a Pages/VPS project has no worker `Env`).
 */
export function generateWorkerTypesCommand(config: DeployableConfig): void {
	const written = generateWorkerTypes(config, resolveConfigDir())
	if (!written.length) {
		logger.info(
			'generate-worker-types is a no-op: target is not cloudflare-workers',
		)
		return
	}
	logger.info(`Generated ${written.length} worker file(s)`)
}
