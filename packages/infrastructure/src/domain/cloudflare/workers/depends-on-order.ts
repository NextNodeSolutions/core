interface DependsOnNode {
	readonly dependsOn: ReadonlyArray<string>
}

/**
 * Group services into deploy levels so every service deploys AFTER the ones
 * it lists in `depends_on`: each level holds, in declaration order, every
 * service whose dependencies all sit in the levels before it, so the services
 * of one level depend on none of each other and deploy together. A stable
 * topological sort: two independent services keep their nextnode.toml order
 * and the result is deterministic run to run.
 *
 * Throws on a dependency cycle (naming the services still tangled) - a cycle has
 * no valid deploy order, so failing loud beats deploying in an arbitrary one.
 * `depends_on` refs are validated against the declared set upstream, so an
 * unknown ref never reaches here.
 */
export function levelServicesByDependsOn(
	services: Readonly<Record<string, DependsOnNode>>,
): ReadonlyArray<ReadonlyArray<string>> {
	const entries = Object.entries(services)
	const pending = new Set(entries.map(([name]) => name))
	const levels: Array<ReadonlyArray<string>> = []

	while (pending.size > 0) {
		const ready = entries
			.filter(
				([name, node]) =>
					pending.has(name) &&
					node.dependsOn.every(dep => !pending.has(dep)),
			)
			.map(([name]) => name)
		if (!ready.length) {
			throw new Error(
				`deploy.services depends_on forms a cycle among: ${[...pending].join(', ')} - remove a dependency so the services can deploy in order.`,
			)
		}
		levels.push(ready)
		for (const name of ready) pending.delete(name)
	}

	return levels
}
