import type { AppEnvironment } from '@/domain/environment.ts'

import type { ServiceEnv } from './service.ts'

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
}

export interface R2ServiceState {
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly buckets: ReadonlyArray<R2BucketBinding>
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
		publicEnv[envKeyForAlias(binding.alias)] = binding.name
	}

	return {
		public: publicEnv,
		secret: {
			R2_ACCESS_KEY_ID: state.accessKeyId,
			R2_SECRET_ACCESS_KEY: state.secretAccessKey,
		},
	}
}
