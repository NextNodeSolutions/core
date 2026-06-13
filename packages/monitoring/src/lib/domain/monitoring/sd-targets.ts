import { selectOwnerProject } from '@/lib/domain/hetzner/vps-state.ts'

import type { VpsStateSlice } from '@/lib/domain/hetzner/vps-state.ts'
import type { TaggedDevice } from '@/lib/domain/tailscale/tagged-device.ts'

/**
 * One http_sd target group, the exact JSON shape vmagent consumes:
 * a target list plus the `__meta_*` labels the client-vps relabel
 * pipeline (packages/infrastructure, client-vps-relabel.ts) maps onto
 * the closed 7-label whitelist.
 */
export interface SdTargetGroup {
	readonly targets: ReadonlyArray<string>
	readonly labels: Readonly<Record<string, string>>
}

/** Tailscale tag marking a workload VPS the monitoring stack scrapes. */
export const CLIENT_VPS_TAG = 'tag:client-vps'

/**
 * Exporter ports on every client VPS: node_exporter on 9100 and cAdvisor
 * on 9101 (golden image contract), postgres-exporter on 9187 (compose
 * sidecar, present whenever the project embeds postgres or Supabase).
 * The state file does not record which VPS actually runs a
 * postgres-exporter, so 9187 is emitted for every client VPS; a VPS
 * without one just shows up=0 on the postgres job, which no alert keys
 * on (PgDown watches pg_up, a metric only an answering exporter emits).
 */
const EXPORTER_PORTS = {
	node: 9100,
	cadvisor: 9101,
	postgres: 9187,
} as const

export interface SdTargetsInput {
	readonly devices: ReadonlyArray<TaggedDevice>
	/** VPS state slice per hostname (null when not provisioned). */
	readonly statesByHostname: Readonly<Record<string, VpsStateSlice | null>>
	/** NN client id label value; omitted from labels when unknown. */
	readonly clientId: string | undefined
}

const buildLabels = (
	device: TaggedDevice,
	exporter: string,
	input: SdTargetsInput,
): Record<string, string> => {
	const state = input.statesByHostname[device.hostname] ?? null
	const ownerProject =
		state === null ? null : selectOwnerProject(state, device.hostname)
	return {
		__meta_tailscale_device_tags: device.tags.join(','),
		__meta_tailscale_device_hostname: device.hostname,
		__meta_nextnode_exporter: exporter,
		...(input.clientId !== undefined && {
			__meta_nextnode_client_id: input.clientId,
		}),
		...(ownerProject !== null && {
			__meta_nextnode_project: ownerProject,
		}),
	}
}

/**
 * Build the http_sd response for /api/sd/targets: one group per
 * (client-vps device, exporter port). Pure - devices and states arrive
 * resolved.
 */
export const buildSdTargets = (
	input: SdTargetsInput,
): ReadonlyArray<SdTargetGroup> =>
	input.devices
		.filter(device => device.tags.includes(CLIENT_VPS_TAG))
		.flatMap(device =>
			Object.entries(EXPORTER_PORTS).map(([exporter, port]) => ({
				targets: [`${device.ipv4}:${String(port)}`],
				labels: buildLabels(device, exporter, input),
			})),
		)
