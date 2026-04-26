import { resolveAccountId } from '#/adapters/cloudflare/accounts.ts'
import { verifyR2Credentials } from '#/adapters/r2/verify-credentials.ts'
import { requireEnv } from '#/cli/env.ts'
import {
	DEFAULT_R2_CERTS_BUCKET,
	DEFAULT_R2_STATE_BUCKET,
} from '#/config/types.ts'
import { computeR2Endpoint } from '#/domain/cloudflare/r2/addressing.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

/**
 * Load the R2 runtime config at deploy time from creds already provisioned
 * by an earlier `ensureR2Setup` run. Resolves the Cloudflare account id via
 * the API, reads the S3 creds from env, and verifies them via a lightweight
 * SigV4 handshake against the state bucket.
 *
 * This is the deploy-time counterpart to `ensureR2Setup`. It intentionally
 * does NOT:
 *   - create or check R2 buckets (provision's job)
 *   - rotate or revoke R2 API tokens (provision's job)
 *   - persist creds as GitHub org secrets (provision's job)
 *
 * Splitting bootstrap from runtime-load keeps `gh secret set --org` calls
 * out of the deploy job, so deploy does not need an org-admin GH_TOKEN.
 * Fails loud on stale creds — the operator should re-run provision to
 * rotate rather than having deploy self-heal silently.
 */
export async function loadR2Runtime(
	cfToken: string,
): Promise<InfraStorageRuntimeConfig> {
	const accountId = await resolveAccountId(cfToken)
	const endpoint = computeR2Endpoint(accountId)
	const accessKeyId = requireEnv('R2_ACCESS_KEY_ID')
	const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY')
	const stateBucket = DEFAULT_R2_STATE_BUCKET
	const certsBucket = DEFAULT_R2_CERTS_BUCKET

	const verify = await verifyR2Credentials({
		accountId,
		accessKeyId,
		secretAccessKey,
		bucketName: stateBucket,
	})
	if (!verify.valid) {
		throw new Error(
			`R2 credentials injected into deploy are stale (${String(verify.status)}: ${verify.body.trim()}). Re-run provision to rotate.`,
		)
	}

	return {
		accountId,
		endpoint,
		accessKeyId,
		secretAccessKey,
		stateBucket,
		certsBucket,
	}
}
