import { createLogger } from '@nextnode-solutions/logger'

import { resolveR2PermissionGroupIds } from '@/adapters/cloudflare/permission-groups.ts'
import { ensureR2Bucket } from '@/adapters/cloudflare/r2/buckets.ts'
import { createR2Token } from '@/adapters/cloudflare/r2/tokens.ts'
import { R2Client } from '@/adapters/r2/client.ts'
import { writeR2ServiceState } from '@/adapters/services/r2-state.ts'
import {
	awaitTokenPropagation,
	revokeStaleTokens,
} from '@/cli/r2/token-lifecycle.ts'
import { R2_BUCKET_LOCATION_HINT } from '@/config/types.ts'
import { computeR2Endpoint } from '@/domain/cloudflare/r2/addressing.ts'
import { deriveR2Credentials } from '@/domain/cloudflare/r2/credentials.ts'
import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '@/domain/environment.ts'
import type { R2ServiceState } from '@/domain/services/r2.ts'
import {
	computeR2BucketBindings,
	r2ServiceStateKey,
	r2ServiceTokenName,
} from '@/domain/services/r2.ts'

const logger = createLogger()

export interface EnsureR2ServiceInput {
	readonly cfToken: string
	readonly infraR2: R2RuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly bucketAliases: ReadonlyArray<string>
}

/**
 * Provision-time bootstrap for the per-project R2 service. Rotates the app
 * token on every call (revoking prior tokens by name) so a corrupted or
 * leaked credential is healed without operator intervention.
 */
export async function ensureR2Service(
	input: EnsureR2ServiceInput,
): Promise<R2ServiceState> {
	const accountId = input.infraR2.accountId
	const bindings = computeR2BucketBindings(
		input.projectName,
		input.environment,
		input.bucketAliases,
	)

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
		probeBucket: bindings[0]!.name,
	})
	await revokeStaleTokens(input.cfToken, tokenName, tokenResult.id)
	logger.info(`R2 service token "${tokenName}" created and verified`)

	const state: R2ServiceState = {
		endpoint: computeR2Endpoint(accountId),
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		buckets: bindings,
	}

	const stateKey = r2ServiceStateKey(input.projectName, input.environment)
	await writeR2ServiceState(
		new R2Client({
			endpoint: input.infraR2.endpoint,
			accessKeyId: input.infraR2.accessKeyId,
			secretAccessKey: input.infraR2.secretAccessKey,
			bucket: input.infraR2.stateBucket,
		}),
		stateKey,
		state,
	)
	logger.info(`R2 service state persisted to state bucket at "${stateKey}"`)

	return state
}
