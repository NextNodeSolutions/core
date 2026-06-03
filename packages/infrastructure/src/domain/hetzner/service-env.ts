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
 * least-privilege by construction: each service receives only the secrets it
 * needs (see `projectSecretsForService` for the rule). One entry per service,
 * keyed by instance name; a service that needs and declares nothing maps to an
 * empty record. The shared `.env` the DB sidecar + migrate read is built
 * separately — see `selectBackingSecrets`.
 */
export function buildServiceSecretEnv(
	services: Readonly<Record<string, UserServiceConfig>>,
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
 *   - a BACKING secret — produced by another service, so `origins` names its
 *     producer (e.g. `DATABASE_URL` → `postgres`) — is included only when the
 *     service declares `needs = [<producer>]`;
 *   - a USER secret — no producer in `origins` — is included only when the
 *     service lists it in its own `secrets`.
 *
 * So a postgres `DATABASE_URL` reaches only services that declare
 * `needs = ["postgres"]`, never a front service that does not (no broadcast).
 */
function projectSecretsForService(
	service: UserServiceConfig,
	secrets: Readonly<Record<string, string>>,
	origins: Readonly<Record<string, string>>,
): Record<string, string> {
	const projected: Record<string, string> = {}
	for (const [key, value] of Object.entries(secrets)) {
		const producer = origins[key]
		const included =
			producer === undefined
				? service.secrets.includes(key)
				: service.needs.includes(producer)
		if (included) projected[key] = value
	}
	return projected
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
