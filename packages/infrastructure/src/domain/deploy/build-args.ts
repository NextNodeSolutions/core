import { computeSiteUrl } from './domain.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * The build args the infra owns and injects into every build target by
 * default - the dev never declares these. Each value is inlined at BUILD time
 * (frameworks like Astro read `site` during `build`, so it cannot wait for the
 * runtime env_file). Computed purely from config + environment, so the build
 * job needs no provisioning state.
 *
 * Today this is `SITE_URL` (environment-aware: `dev.<domain>` vs `<domain>`).
 * Values sourced from deploy-time state (e.g. the R2 endpoint) are NOT here -
 * the build job runs in parallel with provisioning, so that state may not
 * exist yet. Such values stay runtime-only or move to dev-declared `build_args`.
 */
export function computePublicBuildArgs(
	domain: string,
	environment: AppEnvironment,
): Record<string, string> {
	return { SITE_URL: computeSiteUrl(domain, environment) }
}

/**
 * The docker-bake build args for every build service: the infra's `autoArgs`
 * (injected into all build targets) plus the service's own dev-declared
 * `build_args`. Keyed by service name; upstream services contribute no entry.
 * The bake renderer omits the target's `args` key when a service maps to an
 * empty record, so no empty-filtering is needed here.
 */
export function resolveBuildArgs(
	services: Readonly<Record<string, UserServiceConfig>>,
	vars: Readonly<Record<string, string>>,
	autoArgs: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
	const resolved: Record<string, Record<string, string>> = {}
	for (const [name, service] of Object.entries(services)) {
		if (service.source !== 'build') continue
		resolved[name] = {
			...autoArgs,
			...resolveDeclaredBuildArgs(name, service.buildArgs ?? [], vars),
		}
	}
	return resolved
}

// Resolve a build service's declared `build_args` NAMES against the GitHub
// Variables map, failing loud when one is absent - a declared Variable that was
// never set is a CI config bug, not a value to default away.
function resolveDeclaredBuildArgs(
	serviceName: string,
	names: ReadonlyArray<string>,
	vars: Readonly<Record<string, string>>,
): Record<string, string> {
	const args: Record<string, string> = {}
	for (const key of names) {
		const argValue = vars[key]
		if (argValue === undefined) {
			throw new Error(
				`service "${serviceName}" declares build_arg "${key}" but it is absent from GitHub Variables`,
			)
		}
		args[key] = argValue
	}
	return args
}
