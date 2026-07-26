import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type { AppEnvironment } from '#/domain/environment.ts'

// Structural minima these projections need, so the same primitives drive both a
// Hetzner `UserServiceConfig` (a container) and a `WorkerServiceConfig` (not a
// container) without either layer depending on the other's full shape.
interface UrlBearingService {
	readonly url?: string
}
interface LeastPrivilegeService {
	readonly secrets: ReadonlyArray<string>
	readonly needs: ReadonlyArray<string>
}

const URL_ENV_SUFFIX = '_URL'
// Service `url`s are bare hostnames (validated against project.domain). The
// injected env value carries the scheme so it is directly usable by app code
// (`fetch(process.env.API_URL)`) and consistent with the deploy-wide SITE_URL,
// which is also `https://`-prefixed.
const URL_SCHEME = 'https://'

/**
 * Turn a KEBAB service instance name into its URL env var key:
 * `admin-api` -> `ADMIN_API_URL`. The KEBAB pattern alone does NOT make the
 * result a valid identifier - it admits a leading digit (`2fa` -> `2FA_URL`) -
 * so the workers target validates the derived key at config load
 * (`config/validation/worker-env-keys.ts`), which is also where a key already
 * claimed by the infra is rejected.
 */
export function toUrlEnvKey(serviceName: string): string {
	return `${serviceName.toUpperCase().replaceAll('-', '_')}${URL_ENV_SUFFIX}`
}

/**
 * Build the symmetric cross-service URL block injected into EVERY service's
 * `.env.<name>` (D5). One `<NAME>_URL` entry per service that declares a `url`,
 * resolved per environment and scheme-prefixed to `https://<host>` (so a peer's
 * `API_URL` is `https://dev.api.example.com` in development); internal-only
 * services (no `url`) contribute none - no peer ever learns a `<NAME>_URL` for
 * them.
 *
 * The SAME map is merged into every service (a service receives its own
 * `<NAME>_URL` too), so no service needs to know which peers depend on it:
 * symmetric injection removes the "who knows about whom" coupling.
 */
export function buildServiceUrlEnv(
	services: Readonly<Record<string, UrlBearingService>>,
	environment: AppEnvironment,
): Record<string, string> {
	const urlEnv: Record<string, string> = {}

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (typeof url === 'undefined') continue
		urlEnv[toUrlEnvKey(name)] =
			`${URL_SCHEME}${resolveDeployDomain(url, environment)}`
	}

	return urlEnv
}

/**
 * Route the deploy secrets across the per-service `.env.<name>` files (D5),
 * least-privilege by construction: each service receives only the secrets it
 * needs (see `projectSecretsForService` for the rule). One entry per service,
 * keyed by instance name; a service that needs and declares nothing maps to an
 * empty record. The shared `.env` the DB sidecar + migrate read is built
 * separately - see `selectBackingSecrets`.
 */
export function buildServiceSecretEnv(
	services: Readonly<Record<string, LeastPrivilegeService>>,
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
	return Object.fromEntries(
		Object.entries(services).map(
			([name, service]): [string, Record<string, string>] => [
				name,
				projectSecretsForService(service, secrets, origins),
			],
		),
	)
}

/**
 * The least-privilege secret subset a single service receives. The deploy
 * secrets arrive on two disjoint channels, each with its own rule:
 *
 *   - a BACKING secret - produced by another service, so `origins` names its
 *     producer (e.g. `DATABASE_URL` → `postgres`) - is included only when the
 *     service declares `needs = [<producer>]`;
 *   - a USER secret - no producer in `origins` - is included only when the
 *     service lists it in its own `secrets`.
 *
 * So a postgres `DATABASE_URL` reaches only services that declare
 * `needs = ["postgres"]`, never a front service that does not (no broadcast).
 */
function projectSecretsForService(
	service: LeastPrivilegeService,
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, string> {
	const projected: Record<string, string> = {}
	for (const [key, value] of Object.entries(secrets)) {
		const producer = origins[key]
		const included =
			typeof producer === 'undefined'
				? service.secrets.includes(key)
				: service.needs.includes(producer)
		if (included) projected[key] = value
	}
	return projected
}
