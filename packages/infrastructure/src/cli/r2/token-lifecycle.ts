import { setTimeout as sleep } from 'node:timers/promises'

import {
	deleteUserToken,
	listUserTokens,
} from '#/adapters/cloudflare/r2/tokens.ts'
import { verifyR2Credentials } from '#/adapters/r2/verify-credentials.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const VERIFY_MAX_ATTEMPTS = 5
const VERIFY_INTERVAL_MS = 3_000

export interface AwaitTokenPropagationInput {
	readonly accountId: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly probeBucket: string
}

/**
 * Poll until newly-minted R2 credentials become active for SigV4 access.
 * Cloudflare propagates new tokens through their edge asynchronously, so
 * the verify call may 401/403 for a few seconds after `POST /user/tokens`
 * returns. Throws if propagation takes longer than the configured budget.
 */
export async function awaitTokenPropagation(
	input: AwaitTokenPropagationInput,
): Promise<void> {
	for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling by design
		const result = await verifyR2Credentials({
			accountId: input.accountId,
			accessKeyId: input.accessKeyId,
			secretAccessKey: input.secretAccessKey,
			bucketName: input.probeBucket,
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

/**
 * Best-effort revoke every prior token sharing `tokenName` (other than the
 * one we just minted). Failures log and propagate to the next run rather
 * than aborting — partial cleanup is preferable to leaving the new token
 * unactivated.
 */
export async function revokeStaleTokens(
	cfToken: string,
	tokenName: string,
	keepTokenId: string,
): Promise<void> {
	const existing = await listUserTokens(cfToken)
	const stale = existing.filter(
		t => t.name === tokenName && t.id !== keepTokenId,
	)
	if (stale.length === 0) return

	await Promise.all(
		stale.map(async token => {
			try {
				await deleteUserToken(cfToken, token.id)
				logger.info(`Revoked stale R2 token ${token.id}`)
			} catch (error) {
				logger.warn(
					`Failed to revoke stale R2 token ${token.id}: ${String(error)} — will retry on next run`,
				)
			}
		}),
	)
}
