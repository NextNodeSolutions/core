/**
 * Identify VPS that exist on Hetzner (created by us, label
 * managed_by=nextnode) but for which no R2 state object exists.
 *
 * Caused by: state object manually deleted, provision crash between
 * createServer and writeState, R2 state corruption / restore-from-backup
 * gap. The recover CLI uses this to surface stateless servers and let
 * the operator (or monitoring UI) clean them up.
 *
 * Pure: takes the Hetzner-side inventory + a set of vpsNames known to
 * have R2 state; returns the difference.
 */
export interface HetznerServerSummary {
	readonly id: number
	readonly vpsName: string
}

export interface OrphanVps {
	readonly vpsName: string
	readonly serverIds: ReadonlyArray<number>
}

export function findOrphanVps(
	servers: ReadonlyArray<HetznerServerSummary>,
	knownStateVpsNames: ReadonlySet<string>,
): ReadonlyArray<OrphanVps> {
	const grouped = new Map<string, Array<number>>()
	for (const server of servers) {
		if (knownStateVpsNames.has(server.vpsName)) continue
		const list = grouped.get(server.vpsName) ?? []
		list.push(server.id)
		grouped.set(server.vpsName, list)
	}
	return [...grouped.entries()].map(([vpsName, serverIds]) => ({
		vpsName,
		serverIds,
	}))
}
