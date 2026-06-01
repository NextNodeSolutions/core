import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { CaddyUpstream } from '#/domain/caddy/config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Map a project's declared services to the Caddy upstreams that route external
 * traffic to them. One upstream per service that declares a `url`; services
 * without a `url` are internal-only (peer-reachable over the compose network)
 * and contribute no Caddy route. Each routed service dials the host port it was
 * allocated, keyed by its instance name in `hostPorts`.
 *
 * The `url` is the production hostname; the actual routed hostname is resolved
 * per environment via `resolveDeployDomain` (so `api.example.com` routes at
 * `dev.api.example.com` in development), keeping the Caddy route, the ACME cert
 * subject derived from it, and the DNS record in lockstep.
 *
 * A service that declares a `url` but has no entry in `hostPorts` is an
 * unroutable state (Caddy would have a subject with nothing to dial) — fail
 * loud rather than emit a dangling route.
 */
export function buildServiceUpstreams(
	services: Readonly<Record<string, UserServiceConfig>>,
	hostPorts: Readonly<Record<string, number>>,
	environment: AppEnvironment,
): ReadonlyArray<CaddyUpstream> {
	const upstreams: CaddyUpstream[] = []

	for (const [name, service] of Object.entries(services)) {
		const { url } = service
		if (url === undefined) continue

		const port = hostPorts[name]
		if (port === undefined) {
			throw new Error(
				`No host port allocated for routed service "${name}" (url "${url}"); every service declaring a url needs an allocated host port`,
			)
		}

		upstreams.push({
			hostname: resolveDeployDomain(url, environment),
			dial: `localhost:${port}`,
		})
	}

	return upstreams
}
