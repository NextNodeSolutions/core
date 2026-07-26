import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { buildServiceUrlEnv } from '#/domain/deploy/service-env.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import {
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	typesPlaceholderOutputs,
} from './outputs-env.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
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
	// EVERY worker of the project, so the peer URL block can be derived. Not
	// filtered by `needs`: the block is symmetric.
	readonly workerServices: Readonly<Record<string, WorkerServiceConfig>>
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
 * config. Three disjoint sources:
 *
 *   - the backing env (D1/KV/Queue ids, R2 bucket names + CDN URLs, endpoint)
 *     of the backing services THIS worker declares in `needs` - least-privilege,
 *     never the full backing surface;
 *   - one `<NAME>_URL` per routed peer, symmetric: every worker of the project
 *     gets the same block, its own URL included, regardless of `needs`;
 *   - `SITE_URL`, the project's canonical site URL.
 *
 * Disjoint is enforced, not assumed: composition goes through `mergeServiceEnvs`,
 * so a key claimed by two sources throws instead of one silently winning.
 *
 * Calling a sibling and naming it stay separate concerns: the service binding
 * (`env.<NAME>`, see `wrangler-config.ts`) remains the ONLY worker-to-worker
 * call channel, and it is gated by `needs`; `<NAME>_URL` only designates a peer's
 * public host, which is why obtaining one requires no binding. Secrets never
 * travel here (they go through `wrangler secret bulk`); this block is public and
 * lands in the generated config's `vars`.
 */
export function buildWorkerVars(
	input: WorkerVarsInput,
): Record<string, string> {
	const backingEnv = buildWorkersBackingEnv(
		input.outputs,
		input.accountId,
		backingForNeeds(input.backing, input.service.needs),
	)

	return mergeServiceEnvs([
		backingEnv,
		{
			public: buildServiceUrlEnv(input.workerServices, input.environment),
			secret: {},
		},
		{
			public: {
				SITE_URL: computeSiteUrl(
					input.projectDomain,
					input.environment,
				),
			},
			secret: {},
		},
	]).public
}

// Value-side stand-ins for a keys-only query: the account id feeds R2_ENDPOINT's
// value and the domain feeds SITE_URL's, never their keys.
const KEY_SET_ONLY_ACCOUNT_ID = 'key-set-only'
const KEY_SET_ONLY_DOMAIN = 'key-set-only.invalid'

/**
 * Every env key the infra itself injects into a worker of this project: SITE_URL
 * and the full backing surface. Derived by asking `buildWorkerVars` - with
 * placeholder values and a worker that needs every declared backing service - so
 * the answer cannot drift from what a deploy actually injects.
 *
 * Peer URLs are deliberately absent: they are what the caller validates against
 * this set (see `config/validation/worker-env-keys.ts`).
 */
export function infraInjectedEnvKeys(
	services: ServicesConfig,
): ReadonlySet<string> {
	const backing = deriveWorkersBackingConfig(services)
	return new Set(
		Object.keys(
			buildWorkerVars({
				projectDomain: KEY_SET_ONLY_DOMAIN,
				environment: 'production',
				service: {
					secrets: [],
					needs: Object.keys(services),
					dependsOn: [],
					entry: '',
					observability: false,
				},
				workerServices: {},
				backing,
				outputs: typesPlaceholderOutputs(backing),
				accountId: KEY_SET_ONLY_ACCOUNT_ID,
			}),
		),
	)
}
