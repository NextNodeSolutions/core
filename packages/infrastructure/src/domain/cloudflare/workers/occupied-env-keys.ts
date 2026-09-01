import {
	bindingMembers,
	buildWorkerEnvDocument,
} from './worker-env-document.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'

/**
 * Every `env.<key>` the infra itself occupies in a worker of this project: the
 * vars it injects (SITE_URL, the whole backing surface) AND the binding names it
 * wires (`ASSETS`, `DB`, `KV_<ALIAS>`, `R2_<ALIAS>`, `QUEUE_<ALIAS>`, and one per
 * sibling worker). Both come from the document a deploy actually builds, so the
 * answer cannot drift from what a deploy actually occupies.
 *
 * Peer URLs are deliberately absent: they are what the caller validates against
 * this set (see `config/validation/worker-env-keys.ts`). Vars and bindings share
 * one `env` namespace, so a peer `<NAME>_URL` colliding with a binding would
 * shadow the sibling `Fetcher` that is the only worker-to-worker call channel.
 */
export function occupiedEnvKeys(
	services: ServicesConfig,
	workerServices: Readonly<Record<string, WorkerServiceConfig>>,
): ReadonlySet<string> {
	// A worker that needs everything the project declares, so the answer covers
	// the whole surface rather than one worker's least-privilege slice.
	const everyNeed = [...Object.keys(services), ...Object.keys(workerServices)]
	// The same workers with their `url` dropped: their NAMES must still resolve
	// the sibling bindings, while contributing no peer URL to the set.
	const urllessWorkers = Object.fromEntries(
		Object.entries(workerServices).map(([name, service]) => [
			name,
			withoutUrl(service),
		]),
	)

	const occupied = new Set<string>()
	for (const [serviceName, service] of Object.entries(workerServices)) {
		const document = buildWorkerEnvDocument({
			serviceName,
			service: { ...withoutUrl(service), needs: everyNeed },
			services,
			workerServices: urllessWorkers,
			secretNames: [],
		})
		for (const key of Object.keys(document.vars ?? {})) occupied.add(key)
		for (const member of bindingMembers(document)) occupied.add(member.name)
	}
	return occupied
}

function withoutUrl(service: WorkerServiceConfig): WorkerServiceConfig {
	const { url, ...withoutRoute } = service
	return withoutRoute
}
