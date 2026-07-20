import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * The deployed Worker script name for a service. Materialised as
 * `<project>-<env>-<service>` so every environment's Workers are namespaced and
 * collision-free in the account. Shared by deploy (wrangler config) and teardown
 * (wrangler delete) so both target the exact same script.
 */
export function computeWorkerScriptName(
	projectName: string,
	environment: AppEnvironment,
	serviceName: string,
): string {
	return `${projectName}-${environment}-${serviceName}`
}
