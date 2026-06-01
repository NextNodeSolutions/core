import type { UserServiceConfig } from '#/config/types.ts'

const URL_ENV_SUFFIX = '_URL'
// Service `url`s are bare hostnames (validated against project.domain). The
// injected env value carries the scheme so it is directly usable by app code
// (`fetch(process.env.API_URL)`) and consistent with the deploy-wide SITE_URL,
// which is also `https://`-prefixed.
const URL_SCHEME = 'https://'

/**
 * Turn a KEBAB service instance name into its URL env var key:
 * `admin-api` -> `ADMIN_API_URL`. Service names are validated KEBAB
 * identifiers, so this always yields a `^[A-Z_][A-Z0-9_]*$` key.
 */
function toUrlEnvKey(serviceName: string): string {
	return `${serviceName.toUpperCase().replaceAll('-', '_')}${URL_ENV_SUFFIX}`
}

/**
 * Build the symmetric cross-service URL block injected into EVERY service's
 * `.env.<name>` (D5). One `<NAME>_URL` entry per service that declares a `url`,
 * scheme-prefixed to `https://<url>`; internal-only services (no `url`)
 * contribute none — no peer ever learns a `<NAME>_URL` for them.
 *
 * The SAME map is merged into every service (a service receives its own
 * `<NAME>_URL` too), so no service needs to know which peers depend on it:
 * symmetric injection removes the "who knows about whom" coupling.
 */
export function buildServiceUrlEnv(
	services: Readonly<Record<string, UserServiceConfig>>,
): Record<string, string> {
	const urlEnv: Record<string, string> = {}

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (url === undefined) continue
		urlEnv[toUrlEnvKey(name)] = `${URL_SCHEME}${url}`
	}

	return urlEnv
}

/**
 * Route the deploy secrets across the per-service `.env.<name>` files (D5).
 *
 * A user secret declared in `[deploy.secrets]` is isolated to the services that
 * name it in their own `secrets` list: each service's env is the pool projected
 * through its `secrets` (set intersection), so a leaked `.env.front` exposes only
 * front's declared subset, never the whole pool.
 *
 * A secret that NO service claims is service-required — auto-injected by a
 * backing service (e.g. postgres `DATABASE_URL`) rather than user-declared — and
 * broadcasts to every service, preserving its existing injection path. The two
 * sets are disjoint (a service's declared keys are, by definition, claimed), so
 * the merge never collides.
 *
 * Returns one entry per service, keyed by instance name; a service that declares
 * no secrets and runs without any backing service maps to an empty record.
 */
export function buildServiceSecretEnv(
	services: Readonly<Record<string, UserServiceConfig>>,
	secrets: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
	const claimed = new Set(
		Object.values(services).flatMap(service => service.secrets),
	)
	const broadcast = Object.fromEntries(
		Object.entries(secrets).filter(([key]) => !claimed.has(key)),
	)

	const byService: Record<string, Record<string, string>> = {}
	for (const [name, service] of Object.entries(services)) {
		const declared = Object.fromEntries(
			Object.entries(secrets).filter(([key]) =>
				service.secrets.includes(key),
			),
		)
		byService[name] = { ...broadcast, ...declared }
	}

	return byService
}
