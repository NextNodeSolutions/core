import { CLIENT_VPS_TAG } from '#/domain/monitoring/client-vps-relabel.ts'

/**
 * Every NextNode VPS keeps the historical `tag:server` (existing ACL
 * grants - CI SSH over the tailnet - key on it), plus a monitoring role
 * tag the SD layer discriminates on:
 *
 *   - `tag:client-vps` - a workload VPS, scraped by the monitoring
 *     stack (node_exporter/cAdvisor/postgres-exporter over the tailnet).
 *   - `tag:monitoring` - the VPS hosting the observability stack
 *     itself. Deliberately NOT client-vps: the relabel pipeline drops
 *     it, and it is scraped by the static `self` job instead.
 *
 * The role derives from the project's services: declaring
 * `[services.observability]` makes the VPS the monitoring host. No
 * VPS-name special case - the behaviour reproduces on any future VPS.
 */
export const SERVER_TAG = 'tag:server'
export const MONITORING_TAG = 'tag:monitoring'
export const CLIENT_VPS_FULL_TAG = `tag:${CLIENT_VPS_TAG}`

export function computeTailscaleTags(
	hasObservability: boolean,
): ReadonlyArray<string> {
	return [SERVER_TAG, hasObservability ? MONITORING_TAG : CLIENT_VPS_FULL_TAG]
}
