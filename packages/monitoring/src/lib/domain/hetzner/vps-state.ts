import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * The slice of the infra state file (`hetzner/<vps>.json` in the
 * nextnode-state bucket) the service-discovery layer consumes: the
 * public IP (probe targets) and the host-port map whose project keys
 * reveal which projects live on the VPS.
 */
export interface VpsStateSlice {
	readonly publicIp: string | null
	readonly projects: ReadonlyArray<string>
}

export const parseVpsState = (payload: unknown): VpsStateSlice | null => {
	if (!isRecord(payload)) return null
	const publicIp =
		typeof payload.publicIp === 'string' ? payload.publicIp : null
	const projects = isRecord(payload.hostPorts)
		? Object.keys(payload.hostPorts).toSorted((a, b) => a.localeCompare(b))
		: []
	return { publicIp, projects }
}

/**
 * The project whose name a VPS's machine metrics carry (the PRD's
 * "projet propriétaire") : the project named like the VPS when present,
 * otherwise the only project, otherwise the first alphabetically. A VPS
 * with no deployed project yet yields null - its targets ship without a
 * project label until the first deploy.
 */
export const selectOwnerProject = (
	state: VpsStateSlice,
	vpsHostname: string,
): string | null => {
	if (state.projects.includes(vpsHostname)) return vpsHostname
	return state.projects[0] ?? null
}
