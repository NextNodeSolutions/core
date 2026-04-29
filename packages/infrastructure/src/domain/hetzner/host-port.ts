export const HOST_PORT_MIN = 8080
export const HOST_PORT_MAX = 8200

export interface HostPortAllocation {
	readonly port: number
	// true when a fresh port was assigned and the caller must persist the
	// updated map; false when the project already had a port and the caller
	// can skip the write.
	readonly allocated: boolean
}

export function allocateHostPort(
	hostPorts: Readonly<Record<string, number>>,
	projectName: string,
): HostPortAllocation {
	const existing = hostPorts[projectName]
	if (existing !== undefined) {
		return { port: existing, allocated: false }
	}

	const taken = new Set<number>(Object.values(hostPorts))
	for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
		if (!taken.has(port)) {
			return { port, allocated: true }
		}
	}

	throw new Error(
		`Host port range [${HOST_PORT_MIN}, ${HOST_PORT_MAX}) exhausted; cannot allocate port for project "${projectName}"`,
	)
}
