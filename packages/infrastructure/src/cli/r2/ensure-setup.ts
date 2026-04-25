import { createLogger } from '@nextnode-solutions/logger'

import { resolveAccountId } from '@/adapters/cloudflare/accounts.ts'
import { ensureR2Bucket } from '@/adapters/cloudflare/r2/buckets.ts'
import { createOrgSecretsAdapter } from '@/adapters/github/org-secrets.ts'
import { verifyR2Credentials } from '@/adapters/r2/verify-credentials.ts'
import {
	DEFAULT_R2_CERTS_BUCKET,
	DEFAULT_R2_STATE_BUCKET,
	R2_BUCKET_LOCATION_HINT,
} from '@/config/types.ts'
import { computeR2Endpoint } from '@/domain/cloudflare/r2/addressing.ts'
import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

import type { R2Context } from './context.ts'
import type { R2Credentials } from './rotate-token.ts'
import { rotateR2Credentials } from './rotate-token.ts'

const logger = createLogger()

const ENV_R2_ACCESS_KEY = 'R2_ACCESS_KEY_ID'
const ENV_R2_SECRET_KEY = 'R2_SECRET_ACCESS_KEY'
const ENV_GITHUB_OWNER = 'GITHUB_REPOSITORY_OWNER'
const GH_SECRET_ACCOUNT_ID = 'CLOUDFLARE_ACCOUNT_ID'

async function resolveCredsOrRotate(ctx: R2Context): Promise<R2Credentials> {
	const accessKeyId = process.env[ENV_R2_ACCESS_KEY]
	const secretAccessKey = process.env[ENV_R2_SECRET_KEY]
	if (!accessKeyId || !secretAccessKey) {
		logger.info('No R2 credentials injected — provisioning new ones')
		return rotateR2Credentials(ctx)
	}

	const verify = await verifyR2Credentials({
		accountId: ctx.accountId,
		accessKeyId,
		secretAccessKey,
		bucketName: ctx.stateBucket,
	})
	if (verify.valid) {
		logger.info('Existing R2 credentials verified')
		return { accessKeyId, secretAccessKey }
	}
	logger.warn(
		`Existing R2 credentials are stale (${String(verify.status)}: ${verify.body}) — rotating via Cloudflare API`,
	)
	return rotateR2Credentials(ctx)
}

async function persistOrgSecrets(
	accountId: string,
	creds: R2Credentials,
): Promise<void> {
	const org = process.env[ENV_GITHUB_OWNER]
	if (!org) {
		logger.warn(
			`${ENV_GITHUB_OWNER} not set — skipping GitHub org secret persistence`,
		)
		return
	}

	const orgSecrets = createOrgSecretsAdapter()
	const available = await orgSecrets.ghAvailable()
	if (!available) {
		logger.warn(
			'gh CLI unavailable — cannot persist R2 secrets to GitHub org. They will need to be recreated on the next run.',
		)
		return
	}

	await orgSecrets.setOrgSecret(GH_SECRET_ACCOUNT_ID, accountId, org)
	await orgSecrets.setOrgSecret(ENV_R2_ACCESS_KEY, creds.accessKeyId, org)
	await orgSecrets.setOrgSecret(ENV_R2_SECRET_KEY, creds.secretAccessKey, org)
	logger.info(`R2 credentials stored as GitHub org secrets on "${org}"`)
}

/**
 * Self-healing R2 bootstrap. Starting from the Cloudflare API token alone:
 *
 *   1. Resolve the Cloudflare account id via `GET /accounts`.
 *   2. Ensure both R2 buckets (state + certs) exist.
 *   3. If R2 creds are in env and verify via SigV4 handshake → reuse.
 *   4. Otherwise, create a new R2 API token scoped to both buckets, poll
 *      until it propagates, revoke stale tokens, persist as GitHub org
 *      secrets.
 *
 * Returns the resolved `R2RuntimeConfig` — callers thread it explicitly
 * into adapters that need R2 (no hidden coupling via `process.env`).
 */
export async function ensureR2Setup(cfToken: string): Promise<R2RuntimeConfig> {
	const stateBucket = DEFAULT_R2_STATE_BUCKET
	const certsBucket = DEFAULT_R2_CERTS_BUCKET

	const accountId = await resolveAccountId(cfToken)
	logger.info(`Cloudflare account: ${accountId}`)

	await ensureR2Bucket({
		token: cfToken,
		accountId,
		bucketName: stateBucket,
		locationHint: R2_BUCKET_LOCATION_HINT,
	})
	await ensureR2Bucket({
		token: cfToken,
		accountId,
		bucketName: certsBucket,
		locationHint: R2_BUCKET_LOCATION_HINT,
	})

	const ctx: R2Context = { cfToken, accountId, stateBucket, certsBucket }
	const creds = await resolveCredsOrRotate(ctx)
	await persistOrgSecrets(accountId, creds)

	return {
		accountId,
		endpoint: computeR2Endpoint(accountId),
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		stateBucket,
		certsBucket,
	}
}
