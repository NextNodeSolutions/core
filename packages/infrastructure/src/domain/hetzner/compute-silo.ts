import type { EnvSilo } from './env-silo.ts'

/**
 * Compute the silo identity for a (project, env) pair.
 *
 * The id (`<project>-<env>`) is the single slug used as a namespace
 * for all per-environment resources: Docker Compose project name,
 * network, volumes, file paths, etc.
 *
 * Additional fields (subnet, paths, volume prefix) will be added
 * as adapters that consume them are built.
 */
export function computeSilo(projectName: string, envName: string): EnvSilo {
	return { id: `${projectName}-${envName}` }
}
