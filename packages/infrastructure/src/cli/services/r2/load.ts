import { R2Client } from '#/adapters/r2/client.ts'
import { verifyR2Credentials } from '#/adapters/r2/verify-credentials.ts'
import { readR2ServiceState } from '#/adapters/services/r2-state.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { R2ServiceState } from '#/domain/services/r2.ts'
import { r2ServiceStateKey } from '#/domain/services/r2.ts'

export interface LoadR2ServiceInput {
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
}

/**
 * Deploy-time R2 service load. Throws on missing state or stale creds —
 * the operator re-runs provision rather than having deploy self-heal.
 */
export async function loadR2Service(
	input: LoadR2ServiceInput,
): Promise<R2ServiceState> {
	const stateKey = r2ServiceStateKey(input.projectName, input.environment)
	const state = await readR2ServiceState(
		new R2Client({
			endpoint: input.infraStorage.endpoint,
			accessKeyId: input.infraStorage.accessKeyId,
			secretAccessKey: input.infraStorage.secretAccessKey,
			bucket: input.infraStorage.stateBucket,
		}),
		stateKey,
	)
	if (!state) {
		throw new Error(
			`R2 service state not found at "${stateKey}" — run provision before deploy`,
		)
	}
	if (state.buckets.length === 0) {
		throw new Error(
			`R2 service state at "${stateKey}" has no buckets — corrupt state, re-run provision`,
		)
	}

	const verify = await verifyR2Credentials({
		accountId: input.infraStorage.accountId,
		accessKeyId: state.accessKeyId,
		secretAccessKey: state.secretAccessKey,
		bucketName: state.buckets[0]!.name,
	})
	if (!verify.valid) {
		throw new Error(
			`R2 service credentials at "${stateKey}" are stale (${String(verify.status)}: ${verify.body.trim()}). Re-run provision to rotate.`,
		)
	}

	return state
}
