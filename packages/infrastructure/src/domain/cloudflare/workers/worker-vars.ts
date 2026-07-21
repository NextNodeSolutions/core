import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import { buildWorkersBackingEnv } from './outputs-env.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	WorkersBackingConfig,
	WorkersTerraformOutputs,
} from './outputs-env.ts'

export interface WorkerVarsInput {
	readonly projectDomain: string
	readonly environment: AppEnvironment
	// The worker whose vars are built (its `needs` filter the backing env).
	readonly service: WorkerServiceConfig
	readonly backing: WorkersBackingConfig
	readonly outputs: WorkersTerraformOutputs
	readonly accountId: string
}

// Keep only the backing resources this worker declares in `needs`, so its public
// env carries the ids/names/URLs of exactly the backing services it binds - the
// same least-privilege filter `wrangler-config.ts` applies to the bindings
// themselves (a worker that does not `need` a resource sees neither its binding
// nor its env). The producer names match the `[services.*]` keys the worker
// lists in `needs`.
function backingForNeeds(
	backing: WorkersBackingConfig,
	needs: ReadonlyArray<string>,
): WorkersBackingConfig {
	const wantsR2 = needs.includes('r2')
	return {
		hasD1: backing.hasD1 && needs.includes('d1'),
		// PlanetScale projects no env var (the Hyperdrive binding, not a string,
		// reaches Postgres); kept in the filtered shape for consistency.
		hasPlanetscale: backing.hasPlanetscale && needs.includes('planetscale'),
		kvAliases: needs.includes('kv') ? backing.kvAliases : [],
		queueAliases: needs.includes('queues') ? backing.queueAliases : [],
		bucketAliases: wantsR2 ? backing.bucketAliases : [],
		cdnBucketAliases: wantsR2 ? backing.cdnBucketAliases : [],
	}
}

/**
 * Build the public `vars` block injected into one Worker's generated wrangler
 * config. Two sources, precedence low-to-high on the (pathological) key
 * collision:
 *
 *   - the backing env (D1/KV/Queue ids, R2 bucket names + CDN URLs, endpoint)
 *     of the backing services THIS worker declares in `needs` - least-privilege,
 *     never the full backing surface;
 *   - `SITE_URL`, the project's canonical site URL, always authoritative.
 *
 * Worker-to-worker addressing is NOT here: a Worker reaches a sibling only
 * through its service binding (`env.<NAME>`, see `wrangler-config.ts`), never a
 * `<NAME>_URL`. Secrets never travel here either (they go through `wrangler
 * secret bulk`); this block is public and lands in the generated config's `vars`.
 */
export function buildWorkerVars(
	input: WorkerVarsInput,
): Record<string, string> {
	const backingEnv = buildWorkersBackingEnv(
		input.outputs,
		input.accountId,
		backingForNeeds(input.backing, input.service.needs),
	).public

	return {
		...backingEnv,
		SITE_URL: computeSiteUrl(input.projectDomain, input.environment),
	}
}
