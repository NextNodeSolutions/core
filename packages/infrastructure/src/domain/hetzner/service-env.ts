import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

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
 * resolved per environment and scheme-prefixed to `https://<host>` (so a peer's
 * `API_URL` is `https://dev.api.example.com` in development); internal-only
 * services (no `url`) contribute none — no peer ever learns a `<NAME>_URL` for
 * them.
 *
 * The SAME map is merged into every service (a service receives its own
 * `<NAME>_URL` too), so no service needs to know which peers depend on it:
 * symmetric injection removes the "who knows about whom" coupling.
 */
export function buildServiceUrlEnv(
	services: Readonly<Record<string, UserServiceConfig>>,
	environment: AppEnvironment,
): Record<string, string> {
	const urlEnv: Record<string, string> = {}

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (url === undefined) continue
		urlEnv[toUrlEnvKey(name)] =
			`${URL_SCHEME}${resolveDeployDomain(url, environment)}`
	}

	return urlEnv
}

/**
 * Route the deploy secrets across the per-service `.env.<name>` files (D5),
 * least-privilege by construction — a service receives ONLY the secrets it needs:
 *
 *   - a USER secret (declared in some service's `secrets` list) goes only to the
 *     services that name it in their own `secrets`;
 *   - a BACKING secret (produced by a service like postgres — identified by being
 *     present in `origins`, which maps each backing key to its producer's name)
 *     goes only to the services that declare `needs = [<producer>]`.
 *
 * The two channels are disjoint (a key is backing iff it appears in `origins`),
 * so there is no broadcast: a `DATABASE_URL` from postgres lands only in the
 * `.env.<name>` of services that declare `needs = ["postgres"]`, never in a
 * front service that does not. The shared `.env` the DB sidecar + migrate read
 * is built separately (see `selectBackingSecrets`).
 *
 * Returns one entry per service, keyed by instance name; a service that needs
 * and declares nothing maps to an empty record.
 */
export function buildServiceSecretEnv(
	services: Readonly<Record<string, UserServiceConfig>>,
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, Record<string, string>> {
	const byService: Record<string, Record<string, string>> = {}
	for (const [name, service] of Object.entries(services)) {
		const projected: Record<string, string> = {}
		for (const [key, value] of Object.entries(secrets)) {
			const producer = origins[key]
			const wanted =
				producer === undefined
					? service.secrets.includes(key) // user secret → declared only
					: service.needs.includes(producer) // backing → needs only
			if (wanted) projected[key] = value
		}
		byService[name] = projected
	}

	return byService
}

/**
 * Select the BACKING-service secrets (those a `Service` produced, identified via
 * `origins`) for the shared `.env` the embedded-postgres sidecar
 * (`env_file: ['.env']`), the backup sidecar (`${VAR}` compose interpolation),
 * and the ephemeral migrate container (`--env-file .env`) read. User secrets are
 * excluded on purpose: the DB/backup/migrate infra needs `DATABASE_URL`,
 * `POSTGRES_PASSWORD`, `R2_*` — never the app's `SESSION_KEY`.
 */
export function selectBackingSecrets(
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(secrets).filter(([key]) => origins[key] !== undefined),
	)
}
