import type { R2BucketConfig, ServicesConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from './service.ts'

/**
 * Alias every Supabase project carries on its R2 service. The bucket
 * `<project>-<env>-backups` is provisioned alongside the project's other
 * R2 buckets and reuses the project's existing R2 service token at
 * provision time. The monitoring backup-tracker reads it back through a
 * separate read-only token issued later.
 */
export const R2_BACKUPS_ALIAS = 'backups'

/**
 * Per-project R2 buckets declared in `[r2] buckets = [...]`. Each declared
 * alias is materialised as a real Cloudflare R2 bucket via
 * `computeR2BucketName`, scoped per environment so production and preview
 * deployments never write into the same physical bucket.
 *
 * The state payload is what the deploy job reads back from the infra
 * state bucket: a single API token (read+write) on every declared bucket,
 * and the resolved bucket-name binding map. App code reaches buckets by
 * alias via `R2_BUCKET_<ALIAS>` env vars (see `buildR2ServiceEnv`).
 */
export interface R2BucketBinding {
	readonly alias: string
	readonly name: string
	// Public CDN URL when the bucket opts into `cdn = true` and the project
	// has a domain. Absent for private buckets — `buildR2ServiceEnv` then
	// emits no `R2_BUCKET_<ALIAS>_URL` for them.
	readonly publicUrl?: string
}

export interface R2ServiceState {
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly buckets: ReadonlyArray<R2BucketBinding>
}

/**
 * Resolve the buckets the R2 service must provision for a project.
 *
 * Combines the explicit `[services.r2].buckets` list (declared order +
 * `cdn` flags preserved) with the implicit `backups` bucket every project
 * opting into `[services.supabase]` needs. The implicit backups bucket is
 * always private (`cdn: false`) — it is internal and must never be served
 * over a public custom domain. An empty result means the R2 service does
 * not need to run for this project — callers use that as the skip signal.
 *
 * Idempotent: a user who already declared `backups` in `[services.r2]`
 * keeps their own declaration, not a duplicate.
 */
export function computeR2ServiceBuckets(
	services: ServicesConfig,
): ReadonlyArray<R2BucketConfig> {
	const explicit = services.r2?.buckets ?? []
	if (services.supabase === undefined) return explicit
	if (explicit.some(bucket => bucket.name === R2_BACKUPS_ALIAS)) {
		return explicit
	}
	return [...explicit, { name: R2_BACKUPS_ALIAS, cdn: false }]
}

export function computeR2BucketName(
	projectName: string,
	environment: AppEnvironment,
	alias: string,
): string {
	return `${projectName}-${environment}-${alias}`
}

export function computeR2BucketBindings(
	projectName: string,
	environment: AppEnvironment,
	aliases: ReadonlyArray<string>,
): ReadonlyArray<R2BucketBinding> {
	return aliases.map(alias => ({
		alias,
		name: computeR2BucketName(projectName, environment, alias),
	}))
}

export function r2ServiceTokenName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `nextnode-r2-${projectName}-${environment}`
}

export function r2ServiceStateKey(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `services/r2/${projectName}/${environment}.json`
}

function envKeyForAlias(alias: string): string {
	return `R2_BUCKET_${alias.toUpperCase().replaceAll('-', '_')}`
}

/**
 * Project the state payload to the env vars threaded into the deployed
 * app. Endpoint + bucket-name bindings are public (safe in GITHUB_ENV);
 * the credentials are returned in the secret channel so callers route
 * them through `DeployInput.secrets`, never `writeEnvVar`.
 */
export function buildR2ServiceEnv(state: R2ServiceState): ServiceEnv {
	const publicEnv: Record<string, string> = {
		R2_ENDPOINT: state.endpoint,
	}
	for (const binding of state.buckets) {
		const key = envKeyForAlias(binding.alias)
		publicEnv[key] = binding.name
		if (binding.publicUrl !== undefined) {
			publicEnv[`${key}_URL`] = binding.publicUrl
		}
	}

	return {
		public: publicEnv,
		secret: {
			R2_ACCESS_KEY_ID: state.accessKeyId,
			R2_SECRET_ACCESS_KEY: state.secretAccessKey,
		},
	}
}
