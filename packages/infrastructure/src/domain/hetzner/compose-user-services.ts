import { formatImageRef } from '#/domain/deploy/image-ref.ts'
import { POSTGRES_SIDECAR_SERVICE_NAME } from '#/domain/services/postgres.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { ComposeVolume } from './compose-file.ts'

interface ComposeServiceDependency {
	// `service_healthy` for a sibling that exposes a healthcheck (build /healthz
	// services, the postgres sidecar); `service_started` for one that does not
	// (upstream images), since a health gate on it would never resolve.
	readonly condition: 'service_healthy' | 'service_started'
}

interface ComposeHealthcheck {
	readonly test: ReadonlyArray<string>
	readonly interval: string
	readonly timeout: string
	readonly retries: number
}

export interface ComposeUserService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly healthcheck?: ComposeHealthcheck
	readonly ports?: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
	readonly depends_on?: Readonly<Record<string, ComposeServiceDependency>>
}

// /healthz contract (D7): a `build` service answers a liveness probe so compose
// owns bring-up readiness. `wget` and the `/healthz` route are guaranteed by
// the alpine/distroless-busybox bases NextNode builds its app images on. The
// probe is deliberately NOT applied to `upstream` images: they are pulled
// verbatim, so we can't assume they ship `wget` or answer `/healthz` - forcing
// it would flag a healthy container `unhealthy` and, because depends_on health
// gating now blocks dependents on `service_healthy`, stall any sibling that
// gates on this upstream service. Upstream liveness stays the image's own
// contract until a per-service healthcheck override exists.
const HEALTHCHECK_INTERVAL = '10s'
const HEALTHCHECK_TIMEOUT = '3s'
const HEALTHCHECK_RETRIES = 6

function buildHealthcheck(port: number): ComposeHealthcheck {
	// Probe 127.0.0.1, NOT `localhost`: in the app containers `localhost`
	// resolves to ::1 first, but the node servers bind IPv4 0.0.0.0 only, so a
	// `localhost` probe gets ECONNREFUSED and flags a serving container
	// `unhealthy` (which then stalls every `service_healthy` dependent).
	return {
		test: ['CMD', 'wget', '-q', '-O-', `http://127.0.0.1:${port}/healthz`],
		interval: HEALTHCHECK_INTERVAL,
		timeout: HEALTHCHECK_TIMEOUT,
		retries: HEALTHCHECK_RETRIES,
	}
}

function buildPortMapping(
	service: UserServiceConfig,
	hostPort: number | undefined,
	name: string,
): { ports?: ReadonlyArray<string> } {
	// Only `url` services face the reverse proxy, so only they publish a host
	// port; internal services are reached by siblings over the compose network.
	if (typeof service.url === 'undefined') return {}
	if (typeof hostPort === 'undefined') {
		throw new Error(
			`renderComposeFile: service "${name}" declares a url but has no allocated host port`,
		)
	}
	return {
		ports: [`127.0.0.1:${hostPort}:${service.port}`],
	}
}

// Translate a service's startup ordering into compose `depends_on` gates (D7):
// each sibling listed in `dependsOn` must come up before this service starts,
// and the primary additionally waits on the embedded postgres sidecar. A build
// sibling (or postgres) exposes a healthcheck so it is gated on
// `service_healthy`; an upstream sibling carries no forced probe, so gating it
// on `service_healthy` would never resolve - it is gated on `service_started`.
// Returns an empty object when the service has no dependencies, so the
// `depends_on` key is omitted from the rendered block entirely.
interface DependsOnOptions {
	readonly isPrimary: boolean
	readonly hasPostgres: boolean
}

function buildDependsOn(
	service: UserServiceConfig,
	services: Readonly<Record<string, UserServiceConfig>>,
	{ isPrimary, hasPostgres }: DependsOnOptions,
): { depends_on?: Readonly<Record<string, ComposeServiceDependency>> } {
	const dependencies: Record<string, ComposeServiceDependency> = {}
	for (const sibling of service.dependsOn) {
		dependencies[sibling] = {
			condition: siblingCondition(services[sibling]),
		}
	}
	if (isPrimary && hasPostgres) {
		dependencies[POSTGRES_SIDECAR_SERVICE_NAME] = {
			condition: 'service_healthy',
		}
	}
	if (!Object.keys(dependencies).length) return {}
	return { depends_on: dependencies }
}

// Only services that expose a healthcheck can be gated on `service_healthy`:
// `build` images carry the /healthz probe, `upstream` images do not. Gate an
// upstream sibling (or an unknown one) on `service_started` so the dependency
// can resolve instead of hanging the deploy on a health state that never comes.
function siblingCondition(
	sibling: UserServiceConfig | undefined,
): ComposeServiceDependency['condition'] {
	return sibling?.source === 'build' ? 'service_healthy' : 'service_started'
}

/**
 * Render the user workloads declared under [deploy.services.<name>]. Each
 * gets its own image, per-service env file (`.env.<name>` - the isolation
 * unit, D5) and, for `build` services, a /healthz healthcheck (D7); `upstream`
 * images get no forced probe. Every service gates on the siblings it lists in
 * `dependsOn` (D7); the FIRST declared service is the primary app, which also
 * carries the user-declared volumes and the embedded-postgres `service_healthy`
 * dependency.
 */
export interface UserServicesInput {
	readonly services: Readonly<Record<string, UserServiceConfig>>
	readonly images: Readonly<Record<string, ImageRef>>
	readonly hostPorts: Readonly<Record<string, number>>
	readonly userVolumes: ReadonlyArray<ComposeVolume> | undefined
	readonly hasPostgres: boolean
}

export function buildUserServices({
	services,
	images,
	hostPorts,
	userVolumes,
	hasPostgres,
}: UserServicesInput): Record<string, ComposeUserService> {
	const composeServices: Record<string, ComposeUserService> = {}
	Object.entries(services).forEach(([name, service], index) => {
		const image = images[name]
		if (!image) {
			throw new Error(
				`renderComposeFile: missing image ref for service "${name}"`,
			)
		}
		const isPrimary = index === 0
		composeServices[name] = {
			image: formatImageRef(image),
			restart: 'unless-stopped',
			env_file: [`.env.${name}`],
			// Only `build` images carry the /healthz + wget contract; upstream
			// images are pulled verbatim and get no forced probe (see the
			// HEALTHCHECK_* block above).
			...(service.source === 'build' && {
				healthcheck: buildHealthcheck(service.port),
			}),
			...buildPortMapping(service, hostPorts[name], name),
			...(isPrimary &&
				userVolumes && {
					volumes: userVolumes.map(v => `${v.name}:${v.mount}`),
				}),
			...buildDependsOn(service, services, { isPrimary, hasPostgres }),
		}
	})
	return composeServices
}
