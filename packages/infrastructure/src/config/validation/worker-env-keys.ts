import { infraInjectedEnvKeys } from '#/domain/cloudflare/workers/worker-vars.ts'
import { toUrlEnvKey } from '#/domain/deploy/service-env.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'

// The env var grammar the generated `worker-configuration.d.ts` and the wrangler
// `vars` block both need: a leading digit would emit a member the compiler
// cannot parse. Stricter than the KEBAB service-name pattern, which admits one.
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

/**
 * Reject a worker service whose name derives an env key the infra already
 * injects, or one that is not a valid identifier. The name is what is reserved,
 * not the route: every worker is checked, including an internal one that
 * declares no `url` today, so adding a `url` later cannot break a configuration
 * nobody touched.
 */
export function checkWorkerServiceEnvKeys(
	workerServices: Readonly<Record<string, WorkerServiceConfig>>,
	services: ServicesConfig,
): string[] {
	const reserved = reservedEnvKeys(workerServices, services)

	return Object.keys(workerServices).flatMap(name => {
		const key = toUrlEnvKey(name)
		if (!ENV_KEY_PATTERN.test(key)) {
			return [
				`deploy.services.${name}: the service name yields env key "${key}", which is not a valid identifier - a service name must start with a letter`,
			]
		}
		if (reserved.has(key)) {
			return [
				`deploy.services.${name}: the service name yields env key "${key}", already injected by the infra - rename the service`,
			]
		}
		return []
	})
}

// Every env key a worker already receives from something other than a peer's
// URL: what the infra injects (asked of the deploy-time composer itself, so the
// two cannot drift), plus the secret names. The secrets are the union over ALL
// workers, not the one being checked: the URL block is injected symmetrically,
// so a key collides as soon as ONE worker declares that secret.
function reservedEnvKeys(
	workerServices: Readonly<Record<string, WorkerServiceConfig>>,
	services: ServicesConfig,
): ReadonlySet<string> {
	return new Set([
		...infraInjectedEnvKeys(services),
		...Object.values(workerServices).flatMap(service => service.secrets),
	])
}
