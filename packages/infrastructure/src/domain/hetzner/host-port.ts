export const HOST_PORT_MIN = 8080
export const HOST_PORT_MAX = 8200

export function allocateHostPort(
	hostPorts: Readonly<Record<string, number>>,
	projectName: string,
): number {
	const existing = hostPorts[projectName]
	if (existing !== undefined) {
		return existing
	}

	const taken = new Set<number>(Object.values(hostPorts))
	for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
		if (!taken.has(port)) {
			return port
		}
	}

	throw new Error(
		`Host port range [${HOST_PORT_MIN}, ${HOST_PORT_MAX}) exhausted; cannot allocate port for project "${projectName}"`,
	)
}
