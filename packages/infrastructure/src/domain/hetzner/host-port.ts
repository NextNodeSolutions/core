export const HOST_PORT_MIN = 8080
export const HOST_PORT_MAX = 8200

export interface HostPortAllocation {
	// Host port for every url service of THIS project: reused where the project
	// already had one, freshly allocated otherwise. Services without a url never
	// appear here — they face no reverse proxy and expose no host port.
	readonly ports: Readonly<Record<string, number>>
	// true when at least one fresh port was assigned and the caller must persist
	// the updated nested map; false when every url service already had a port and
	// the caller can skip the write.
	readonly allocated: boolean
}

/**
 * Allocate one host port per externally-routed (`url`) service of a project,
 * reusing any port the project already holds and assigning fresh ones (lowest
 * free port in `[HOST_PORT_MIN, HOST_PORT_MAX)`) for the rest. Ports are unique
 * across EVERY project on the VPS, so the taken set is collected from the whole
 * nested map, not just this project's slice.
 *
 * Idempotent for an already-mapped service: a re-deploy with the same url
 * services returns the same ports and `allocated: false`, so the caller skips
 * the state write.
 */
export function allocateHostPort(
	hostPorts: Readonly<Record<string, Readonly<Record<string, number>>>>,
	projectName: string,
	urlServices: ReadonlyArray<string>,
): HostPortAllocation {
	const existing = hostPorts[projectName] ?? {}
	const taken = collectTakenPorts(hostPorts)

	const ports: Record<string, number> = {}
	let allocated = false
	for (const service of urlServices) {
		const current = existing[service]
		if (current !== undefined) {
			ports[service] = current
			continue
		}
		const port = allocateFreePort(taken, projectName, service)
		ports[service] = port
		taken.add(port)
		allocated = true
	}

	return { ports, allocated }
}

function collectTakenPorts(
	hostPorts: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Set<number> {
	const taken = new Set<number>()
	for (const servicePorts of Object.values(hostPorts)) {
		for (const port of Object.values(servicePorts)) taken.add(port)
	}
	return taken
}

function allocateFreePort(
	taken: ReadonlySet<number>,
	projectName: string,
	service: string,
): number {
	for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
		if (!taken.has(port)) return port
	}

	throw new Error(
		`Host port range [${HOST_PORT_MIN}, ${HOST_PORT_MAX}) exhausted; cannot allocate port for service "${service}" of project "${projectName}"`,
	)
}
