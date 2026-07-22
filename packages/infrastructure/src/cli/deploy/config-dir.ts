import { isAbsolute, resolve } from 'node:path'

import { getEnv, requireEnv } from '#/cli/env.ts'

// The dir the workers' `entry` paths resolve against - the dir holding the
// nextnode.toml. Mirrors the deploy target's project-dir mechanism
// (PIPELINE_CONFIG_FILE against GITHUB_WORKSPACE) but is REQUIRED for generators:
// they always write, so a missing config path is a hard error.
export function resolveConfigDir(): string {
	const configFile = requireEnv('PIPELINE_CONFIG_FILE')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const absoluteConfig = isAbsolute(configFile)
		? configFile
		: resolve(workspace, configFile)
	return resolve(absoluteConfig, '..')
}
