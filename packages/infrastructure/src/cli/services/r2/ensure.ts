import { lookupZoneId } from '#/adapters/cloudflare/dns/api.ts'
import { resolveR2PermissionGroupIds } from '#/adapters/cloudflare/permission-groups.ts'
import { ensureR2Bucket } from '#/adapters/cloudflare/r2/buckets.ts'
import { ensureR2CustomDomain } from '#/adapters/cloudflare/r2/domains.ts'
import { createR2Token } from '#/adapters/cloudflare/r2/tokens.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import { writeR2ServiceState } from '#/adapters/services/r2-state.ts'
import {
	awaitTokenPropagation,
	revokeStaleTokens,
} from '#/cli/r2/token-lifecycle.ts'
import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { extractRootDomain } from '#/domain/cloudflare/dns-records.ts'
import { computeR2Endpoint } from '#/domain/cloudflare/r2/addressing.ts'
import { deriveR2Credentials } from '#/domain/cloudflare/r2/credentials.ts'
import {
	computeR2CustomDomainHostname,
	computeR2PublicUrl,
} from '#/domain/cloudflare/r2/custom-domain.ts'
import {
	computeR2BucketBindings,
	r2ServiceStateKey,
	r2ServiceTokenName,
} from '#/domain/services/r2.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { awaitR2DomainActive } from './await-domain-active.ts'

import type { R2BucketConfig } from '#/config/types.ts'
import type { R2StaticCredentials } from '#/domain/cloudflare/r2/credentials.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { R2BucketBinding, R2ServiceState } from '#/domain/services/r2.ts'

const logger = createLogger()

export interface EnsureR2ServiceInput {
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
	// The env-RESOLVED deploy domain (`resolveDeployDomain(project.domain)`,
	// e.g. `dev.example.com` in development), or null when the project declares
	// no domain. When null, no bucket gets a public custom domain. Already
	// resolved upstream in `resolveServices` - never re-resolve it here.
	readonly deployDomain: string | null
	readonly buckets: ReadonlyArray<R2BucketConfig>
}

/**
 * Attach a public custom domain to each `cdn`-enabled bucket and return the
 * bindings enriched with their public URL. Buckets without `cdn` (and every
 * bucket when the project has no domain) pass through untouched.
 *
 * All buckets live under the project's single Cloudflare zone, so the
 * zone id is resolved once. Passing it to the attach call lets Cloudflare
 * auto-create the proxied CNAME - no separate DNS write. Each attach is then
 * polled until its SSL cert is active so the persisted URL actually serves.
 */
async function attachCustomDomains(
	input: EnsureR2ServiceInput,
	accountId: string,
	bindings: ReadonlyArray<R2BucketBinding>,
): Promise<ReadonlyArray<R2BucketBinding>> {
	const { deployDomain } = input
	if (deployDomain === null) return bindings

	const cdnAliases = new Set(
		input.buckets.filter(bucket => bucket.cdn).map(bucket => bucket.name),
	)
	if (cdnAliases.size === 0) return bindings

	const zoneId = await lookupZoneId(
		extractRootDomain(deployDomain),
		input.cfToken,
	)

	return Promise.all(
		bindings.map(async binding => {
			if (!cdnAliases.has(binding.alias)) return binding
			const hostname = computeR2CustomDomainHostname(
				binding.alias,
				deployDomain,
			)
			await ensureR2CustomDomain({
				token: input.cfToken,
				accountId,
				bucketName: binding.name,
				domain: hostname,
				zoneId,
			})
			await awaitR2DomainActive({
				token: input.cfToken,
				accountId,
				bucketName: binding.name,
				domain: hostname,
			})
			logger.info(
				`R2 bucket "${binding.name}" served at https://${hostname}`,
			)
			return { ...binding, publicUrl: computeR2PublicUrl(hostname) }
		}),
	)
}

/**
 * Provision-time bootstrap for the per-project R2 service. Rotates the app
 * token on every call (revoking prior tokens by name) so a corrupted or
 * leaked credential is healed without operator intervention.
 */
export async function ensureR2Service(
	input: EnsureR2ServiceInput,
): Promise<R2ServiceState> {
	const { accountId } = input.infraStorage
	const bindings = computeR2BucketBindings(
		input.projectName,
		input.environment,
		input.buckets.map(bucket => bucket.name),
	)

	const creds = await mintServiceToken(input, bindings)
	const boundBuckets = await attachCustomDomains(input, accountId, bindings)

	const state: R2ServiceState = {
		endpoint: computeR2Endpoint(accountId),
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		buckets: boundBuckets,
	}

	await persistServiceState(input, state)
	return state
}

/**
 * Ensure every bucket exists, then mint (and verify) the per-project R2
 * service token scoped to those buckets, revoking prior tokens by name.
 * Returns the derived S3 credentials.
 */
async function mintServiceToken(
	input: EnsureR2ServiceInput,
	bindings: ReadonlyArray<R2BucketBinding>,
): Promise<R2StaticCredentials> {
	const { accountId } = input.infraStorage
	const [probeBinding] = bindings
	if (!probeBinding) {
		throw new Error(
			`R2 service for "${input.projectName}" declares no buckets - nothing to provision`,
		)
	}

	const [, permissions] = await Promise.all([
		Promise.all(
			bindings.map(async binding => {
				const created = await ensureR2Bucket({
					token: input.cfToken,
					accountId,
					bucketName: binding.name,
					locationHint: R2_BUCKET_LOCATION_HINT,
				})
				logger.info(
					created
						? `Created R2 bucket "${binding.name}" (alias: ${binding.alias})`
						: `R2 bucket "${binding.name}" already exists (alias: ${binding.alias})`,
				)
			}),
		),
		resolveR2PermissionGroupIds(input.cfToken),
	])

	const tokenName = r2ServiceTokenName(input.projectName, input.environment)
	logger.info(`Creating R2 service API token "${tokenName}"`)

	const tokenResult = await createR2Token({
		token: input.cfToken,
		tokenName,
		accountId,
		bucketNames: bindings.map(b => b.name),
		permissions,
	})
	const creds = deriveR2Credentials(tokenResult)

	await awaitTokenPropagation({
		accountId,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		probeBucket: probeBinding.name,
	})
	await revokeStaleTokens(input.cfToken, tokenName, tokenResult.id)
	logger.info(`R2 service token "${tokenName}" created and verified`)

	return creds
}

/** Persist the service state to the infra state bucket. */
async function persistServiceState(
	input: EnsureR2ServiceInput,
	state: R2ServiceState,
): Promise<void> {
	const stateKey = r2ServiceStateKey(input.projectName, input.environment)
	await writeR2ServiceState(
		new R2Client({
			endpoint: input.infraStorage.endpoint,
			accessKeyId: input.infraStorage.accessKeyId,
			secretAccessKey: input.infraStorage.secretAccessKey,
			bucket: input.infraStorage.stateBucket,
		}),
		stateKey,
		state,
	)
	logger.info(`R2 service state persisted to state bucket at "${stateKey}"`)
}
