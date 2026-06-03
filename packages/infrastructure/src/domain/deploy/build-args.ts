import { computeSiteUrl } from './domain.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * The build args the infra owns and injects into every build target by
 * default — the dev never declares these. Each value is inlined at BUILD time
 * (frameworks like Astro read `site` during `build`, so it cannot wait for the
 * runtime env_file). Computed purely from config + environment, so the build
 * job needs no provisioning state.
 *
 * Today this is `SITE_URL` (environment-aware: `dev.<domain>` vs `<domain>`).
 * Values sourced from deploy-time state (e.g. the R2 endpoint) are NOT here —
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
 * Resolve the docker-bake build args for every build service: the infra's
 * `autoArgs` (injected into all build targets) plus each service's
 * dev-declared `build_args` NAMES resolved against the GitHub Variables map.
 * Fail loud when a declared name is absent from `vars` — that is a CI config
 * bug (a Variable was never set), not a value to default away. Upstream
 * services and build services that end up with no args contribute no entry.
 */
export function resolveBuildArgs(
	services: Readonly<Record<string, UserServiceConfig>>,
	vars: Readonly<Record<string, string>>,
	autoArgs: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
	const resolved: Record<string, Record<string, string>> = {}
	for (const [name, service] of Object.entries(services)) {
		if (service.source !== 'build') continue
		const args: Record<string, string> = { ...autoArgs }
		for (const key of service.buildArgs ?? []) {
			const value = vars[key]
			if (value === undefined) {
				throw new Error(
					`service "${name}" declares build_arg "${key}" but it is absent from GitHub Variables`,
				)
			}
			args[key] = value
		}
		if (Object.keys(args).length > 0) resolved[name] = args
	}
	return resolved
}
