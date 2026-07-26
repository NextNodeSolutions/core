import {
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	typesPlaceholderOutputs,
} from '#/domain/cloudflare/workers/outputs-env.ts'
import { toUrlEnvKey } from '#/domain/deploy/service-env.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'

// The env var grammar the generated `worker-configuration.d.ts` and the wrangler
// `vars` block both need: a leading digit would emit a member the compiler
// cannot parse. Stricter than the KEBAB service-name pattern, which admits one.
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

// Only the account id's KEY set is read here, never a value, and R2_ENDPOINT is
// the sole key whose value the account id feeds - so any string does.
const KEY_SET_ONLY_ACCOUNT_ID = 'key-set-only'

const SITE_URL_KEY = 'SITE_URL'

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
// URL. SITE_URL is reserved unconditionally - even with no `project.domain` -
// so adding a domain later never invalidates a config that used to load. The
// backing keys come from the builder that produces them at deploy time, fed
// placeholder outputs, so the two can never drift. Secret names are the union
// over all workers: the URL block is injected symmetrically, so a key collides
// as soon as ONE worker declares that secret.
function reservedEnvKeys(
	workerServices: Readonly<Record<string, WorkerServiceConfig>>,
	services: ServicesConfig,
): ReadonlySet<string> {
	const backing = deriveWorkersBackingConfig(services)
	const backingEnv = buildWorkersBackingEnv(
		typesPlaceholderOutputs(backing),
		KEY_SET_ONLY_ACCOUNT_ID,
		backing,
	)

	return new Set([
		SITE_URL_KEY,
		...Object.keys(backingEnv.public),
		...Object.values(workerServices).flatMap(service => service.secrets),
	])
}
