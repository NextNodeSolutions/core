interface DependsOnNode {
	readonly dependsOn: ReadonlyArray<string>
}

/**
 * Order services so every service deploys AFTER the ones it lists in
 * `depends_on`. A stable topological sort: at each step it emits, in declaration
 * order, every not-yet-emitted service whose dependencies are all already
 * emitted - so two independent services keep their nextnode.toml order and the
 * result is deterministic run to run.
 *
 * Throws on a dependency cycle (naming the services still tangled) - a cycle has
 * no valid deploy order, so failing loud beats deploying in an arbitrary one.
 * `depends_on` refs are validated against the declared set upstream, so an
 * unknown ref never reaches here.
 */
export function orderServicesByDependsOn(
	services: Readonly<Record<string, DependsOnNode>>,
): ReadonlyArray<string> {
	const entries = Object.entries(services)
	const pending = new Set(entries.map(([name]) => name))
	const ordered: string[] = []

	while (pending.size > 0) {
		const ready = entries.filter(
			([name, node]) =>
				pending.has(name) &&
				node.dependsOn.every(dep => !pending.has(dep)),
		)
		if (ready.length === 0) {
			throw new Error(
				`deploy.services depends_on forms a cycle among: ${[...pending].join(', ')} - remove a dependency so the services can deploy in order.`,
			)
		}
		for (const [name] of ready) {
			ordered.push(name)
			pending.delete(name)
		}
	}

	return ordered
}
