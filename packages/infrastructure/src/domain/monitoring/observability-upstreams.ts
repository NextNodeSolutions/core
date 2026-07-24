import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import {
	VICTORIALOGS_HOST_PORT,
	VICTORIAMETRICS_HOST_PORT,
} from '#/domain/services/observability.ts'

import type { ObservabilityServiceConfig } from '#/config/service-config.ts'
import type { CaddyUpstream } from '#/domain/caddy/config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Caddy routes fronting the observability stack: the logs vhost is the
 * fleet-wide NN_VL_URL Vector pushes to, the metrics vhost serves vmui
 * for ad-hoc exploration. Both resolve to the VPS tailnet IP (the
 * monitoring project is internal), so the only consumers are tailnet
 * members - the trust boundary of the rest of the platform.
 */
export function buildObservabilityUpstreams(
	config: ObservabilityServiceConfig,
	environment: AppEnvironment,
): ReadonlyArray<CaddyUpstream> {
	return [
		{
			hostname: resolveDeployDomain(config.logsVhost, environment),
			dial: `localhost:${String(VICTORIALOGS_HOST_PORT)}`,
		},
		{
			hostname: resolveDeployDomain(config.metricsVhost, environment),
			dial: `localhost:${String(VICTORIAMETRICS_HOST_PORT)}`,
		},
	]
}
