import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { resolveAccountId } from '../../adapters/cloudflare/accounts.ts'
import { resolveR2PermissionGroupIds } from '../../adapters/cloudflare/permission-groups.ts'
import { ensureR2Bucket } from '../../adapters/cloudflare/r2/buckets.ts'
import { createR2Token } from '../../adapters/cloudflare/r2/tokens.ts'
import { createOrgSecretsAdapter } from '../../adapters/github/org-secrets.ts'
import type { OrgSecretsAdapter } from '../../adapters/github/org-secrets.ts'
import { verifyR2Credentials } from '../../adapters/r2/verify-credentials.ts'
import {
	DEFAULT_R2_CERTS_BUCKET,
	DEFAULT_R2_STATE_BUCKET,
	R2_BUCKET_LOCATION_HINT,
} from '../../config/types.ts'
import { computeR2Endpoint } from '../../domain/cloudflare/r2/addressing.ts'
import { deriveR2Credentials } from '../../domain/cloudflare/r2/credentials.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'

const logger = createLogger()

const ENV_R2_ACCESS_KEY = 'R2_ACCESS_KEY_ID'
const ENV_R2_SECRET_KEY = 'R2_SECRET_ACCESS_KEY'
const ENV_GITHUB_OWNER = 'GITHUB_REPOSITORY_OWNER'
const GH_SECRET_ACCOUNT_ID = 'CLOUDFLARE_ACCOUNT_ID'

const VERIFY_MAX_ATTEMPTS = 5
const VERIFY_INTERVAL_MS = 3_000

const TOKEN_NAME = 'nextnode-infrastructure-r2'

export type EnsureR2Result = R2RuntimeConfig

async function awaitTokenPropagation(
	accountId: string,
	accessKeyId: string,
	secretAccessKey: string,
	bucketName: string,
): Promise<void> {
	for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling by design
		const result = await verifyR2Credentials({
			accountId,
			accessKeyId,
			secretAccessKey,
			bucketName,
		})
		if (result.valid) return
		logger.info(
			`R2 credentials not yet active (attempt ${String(attempt)}/${String(VERIFY_MAX_ATTEMPTS)}, ${String(result.status)}: ${result.body})`,
		)
		await sleep(VERIFY_INTERVAL_MS) // eslint-disable-line no-await-in-loop -- sequential polling by design
	}
	throw new Error(
		`R2 credentials did not become active after ${String(VERIFY_MAX_ATTEMPTS)} attempts`,
	)
}

async function storeOrgSecrets(
	orgSecrets: OrgSecretsAdapter,
	org: string,
	accountId: string,
	accessKeyId: string,
	secretAccessKey: string,
): Promise<void> {
	const available = await orgSecrets.ghAvailable()
	if (!available) {
		logger.warn(
			'gh CLI unavailable — cannot persist R2 secrets to GitHub org. They will need to be recreated on the next run.',
		)
		return
	}

	await orgSecrets.setOrgSecret(GH_SECRET_ACCOUNT_ID, accountId, org)
	await orgSecrets.setOrgSecret(ENV_R2_ACCESS_KEY, accessKeyId, org)
	await orgSecrets.setOrgSecret(ENV_R2_SECRET_KEY, secretAccessKey, org)
	logger.info(`R2 credentials stored as GitHub org secrets on "${org}"`)
}

function readExistingCreds(): {
	accessKeyId: string
	secretAccessKey: string
} | null {
	const accessKeyId = process.env[ENV_R2_ACCESS_KEY]
	const secretAccessKey = process.env[ENV_R2_SECRET_KEY]
	if (!accessKeyId || !secretAccessKey) return null
	return { accessKeyId, secretAccessKey }
}

async function rotateR2Credentials(
	cfToken: string,
	accountId: string,
	stateBucket: string,
	certsBucket: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
	logger.info('Creating new R2 API token...')
	const permissions = await resolveR2PermissionGroupIds(cfToken)
	const tokenResult = await createR2Token({
		token: cfToken,
		tokenName: TOKEN_NAME,
		accountId,
		bucketNames: [stateBucket, certsBucket],
		permissions,
	})
	const creds = deriveR2Credentials(tokenResult)

	await awaitTokenPropagation(
		accountId,
		creds.accessKeyId,
		creds.secretAccessKey,
		stateBucket,
	)

	logger.info('R2 API token created and verified')
	return creds
}

async function resolveR2Creds(
	cfToken: string,
	accountId: string,
	stateBucket: string,
	certsBucket: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
	const existing = readExistingCreds()

	if (!existing) {
		logger.info('No R2 credentials injected — provisioning new ones')
		return rotateR2Credentials(cfToken, accountId, stateBucket, certsBucket)
	}

	const verifyResult = await verifyR2Credentials({
		accountId,
		accessKeyId: existing.accessKeyId,
		secretAccessKey: existing.secretAccessKey,
		bucketName: stateBucket,
	})
	if (verifyResult.valid) {
		logger.info('Existing R2 credentials verified')
		return existing
	}
	logger.warn(
		`Existing R2 credentials are stale (${String(verifyResult.status)}: ${verifyResult.body}) — rotating via Cloudflare API`,
	)
	return rotateR2Credentials(cfToken, accountId, stateBucket, certsBucket)
}

/**
 * Self-healing R2 bootstrap. Starting from the Cloudflare API token alone:
 *
 *   1. Resolve the Cloudflare account id via `GET /accounts`.
 *   2. Ensure both R2 buckets (state + certs) exist.
 *   3. If R2 creds are in env and verify via SigV4 handshake → reuse.
 *   4. Otherwise, if the matching GitHub org secrets exist → throw (a CI
 *      run should have injected them).
 *   5. Otherwise, create a new R2 API token scoped to both buckets,
 *      poll until it propagates, and persist creds as GitHub org secrets.
 *
 * Returns the resolved `R2RuntimeConfig` — callers thread it explicitly
 * into adapters that need R2 (no hidden coupling via `process.env`).
 */
export async function ensureR2Setup(cfToken: string): Promise<EnsureR2Result> {
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

	const endpoint = computeR2Endpoint(accountId)
	const orgSecrets = createOrgSecretsAdapter()

	const creds = await resolveR2Creds(
		cfToken,
		accountId,
		stateBucket,
		certsBucket,
	)

	const org = process.env[ENV_GITHUB_OWNER]
	if (org) {
		await storeOrgSecrets(
			orgSecrets,
			org,
			accountId,
			creds.accessKeyId,
			creds.secretAccessKey,
		)
	} else {
		logger.warn(
			`${ENV_GITHUB_OWNER} not set — skipping GitHub org secret persistence`,
		)
	}

	return {
		accountId,
		endpoint,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		stateBucket,
		certsBucket,
	}
}
