import { orderServicesByDependsOn } from './depends-on-order.ts'

interface OrderableWorker {
	readonly needs: ReadonlyArray<string>
	readonly dependsOn: ReadonlyArray<string>
}

/**
 * The sibling workers a service binds. A `needs` entry that names another
 * declared worker (never itself) is a worker-to-worker dependency, wired as a
 * Cloudflare service binding - the only channel Workers reach each other on.
 * Backing needs (`r2`/`d1`/`kv`/`queues`) never name a sibling worker, so the
 * sibling-name set filters them out here; their bindings are built separately.
 * Order and de-duplication follow the `needs` declaration order, deterministic
 * run to run.
 */
export function deriveBoundSiblings(
	serviceName: string,
	needs: ReadonlyArray<string>,
	siblingNames: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const siblings = new Set(siblingNames)
	const seen = new Set<string>()
	const bound: string[] = []
	for (const need of needs) {
		if (need === serviceName || !siblings.has(need) || seen.has(need)) {
			continue
		}
		seen.add(need)
		bound.push(need)
	}
	return bound
}

/**
 * Deploy order for a project's Workers: a Worker deploys AFTER every Worker it
 * binds (a service binding's target must already exist as a script) and after
 * any explicit `depends_on`. The binding graph is the single source of truth -
 * declaring a sibling in `needs` both wires the binding and orders the deploy,
 * so `depends_on` never has to restate a binding. Reuses the generic
 * topological sort (stable, declaration-order tie-break); a binding cycle throws
 * there, naming the tangled workers.
 */
export function orderWorkerDeploy(
	services: Readonly<Record<string, OrderableWorker>>,
): ReadonlyArray<string> {
	const names = Object.keys(services)
	const nodes: Record<string, { dependsOn: ReadonlyArray<string> }> =
		Object.fromEntries(
			Object.entries(services).map(([name, service]) => [
				name,
				{
					dependsOn: [
						...new Set([
							...service.dependsOn,
							...deriveBoundSiblings(name, service.needs, names),
						]),
					],
				},
			]),
		)
	return orderServicesByDependsOn(nodes)
}
