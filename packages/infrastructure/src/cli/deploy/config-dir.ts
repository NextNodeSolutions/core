import { dirname, isAbsolute, resolve } from 'node:path'

import { getEnv, requireEnv } from '#/cli/env.ts'

const CONFIG_FILE_ENV = 'PIPELINE_CONFIG_FILE'

// PIPELINE_CONFIG_FILE resolves against GITHUB_WORKSPACE, the caller's
// checkout, like every path of nextnode.toml.
function configDirOf(configFile: string): string {
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const absoluteConfig = isAbsolute(configFile)
		? configFile
		: resolve(workspace, configFile)
	return dirname(absoluteConfig)
}

/**
 * The directory holding nextnode.toml, which every path the file declares
 * (`entry`, `assets`, `image`, `context`) is relative to. Undefined when
 * PIPELINE_CONFIG_FILE is unset.
 */
export function resolveConfigDir(): string | undefined {
	const configFile = getEnv(CONFIG_FILE_ENV)
	if (!configFile) return undefined
	return configDirOf(configFile)
}

/** `resolveConfigDir` for a command that cannot run without it. */
export function requireConfigDir(): string {
	return configDirOf(requireEnv(CONFIG_FILE_ENV))
}
