import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import { buildWorkersBackingEnv } from './outputs-env.ts'
import { ACCESS_AUDIENCES_OUTPUT } from './terraform-access.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	WorkersBackingConfig,
	WorkersTerraformOutputs,
} from './outputs-env.ts'

export interface WorkerVarsInput {
	readonly projectDomain: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	// The worker whose vars are built (its `needs` filter the backing env).
	readonly service: WorkerServiceConfig
	readonly backing: WorkersBackingConfig
	readonly outputs: WorkersTerraformOutputs
	readonly accountId: string
	// The organization's Zero Trust team domain, required by an internal worker.
	readonly accessTeamDomain: string | undefined
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

function accessVars(input: WorkerVarsInput): Record<string, string> {
	if (!input.service.internal) return {}
	const audience = input.outputs.accessAudiences[input.serviceName]
	if (typeof audience === 'undefined')
		throw new Error(
			`terraform output "${ACCESS_AUDIENCES_OUTPUT}" has no entry for "${input.serviceName}" but the service is internal - run \`infrastructure provision\` before deploy so Terraform creates its Access application.`,
		)
	if (typeof input.accessTeamDomain === 'undefined')
		throw new Error('Internal Workers require organization Access settings')
	return { ACCESS_AUD: audience, ACCESS_TEAM_DOMAIN: input.accessTeamDomain }
}

/**
 * Build the public `vars` block injected into one Worker's generated wrangler
 * config. Two sources, precedence low-to-high on the (pathological) key
 * collision:
 *
 *   - the backing env (D1/KV/Queue ids, R2 bucket names + CDN URLs, endpoint)
 *     of the backing services THIS worker declares in `needs` - least-privilege,
 *     never the full backing surface;
 *   - `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` on an internal worker: the audience
 *     tag of its Access application and the JWT issuer, so the app verifies
 *     the Access JWT without a hand-copied setting;
 *   - `SITE_URL`, this worker's canonical site URL: the service-url-derived
 *     host (dev-prefixed in development) when `[deploy.services.<name>].url` is
 *     declared, else the project-domain fallback (single-service/apex projects).
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

	const siteUrlDomain = input.service.url ?? input.projectDomain

	return {
		...backingEnv,
		...accessVars(input),
		SITE_URL: computeSiteUrl(siteUrlDomain, input.environment),
	}
}
