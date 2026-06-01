import type { UserServiceConfig } from '#/config/types.ts'

const URL_ENV_SUFFIX = '_URL'

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
 * `.env.<name>` (D5). One `<NAME>_URL` entry per service that declares a `url`;
 * internal-only services (no `url`) contribute none — no peer ever learns a
 * `<NAME>_URL` for them.
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
		urlEnv[toUrlEnvKey(name)] = url
	}

	return urlEnv
}
