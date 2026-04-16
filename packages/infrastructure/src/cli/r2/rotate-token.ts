import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { resolveR2PermissionGroupIds } from '../../adapters/cloudflare/permission-groups.ts'
import {
	createR2Token,
	deleteUserToken,
	listUserTokens,
} from '../../adapters/cloudflare/r2/tokens.ts'
import { verifyR2Credentials } from '../../adapters/r2/verify-credentials.ts'
import { deriveR2Credentials } from '../../domain/cloudflare/r2/credentials.ts'

import type { R2Context } from './context.ts'

const logger = createLogger()

export const TOKEN_NAME = 'nextnode-infrastructure-r2'

const VERIFY_MAX_ATTEMPTS = 5
const VERIFY_INTERVAL_MS = 3_000

export interface R2Credentials {
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

async function awaitTokenPropagation(
	ctx: R2Context,
	creds: R2Credentials,
): Promise<void> {
	for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling by design
		const result = await verifyR2Credentials({
			accountId: ctx.accountId,
			accessKeyId: creds.accessKeyId,
			secretAccessKey: creds.secretAccessKey,
			bucketName: ctx.stateBucket,
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

async function revokeStaleTokens(
	cfToken: string,
	keepTokenId: string,
): Promise<void> {
	const existing = await listUserTokens(cfToken)
	const stale = existing.filter(
		t => t.name === TOKEN_NAME && t.id !== keepTokenId,
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

/**
 * Rotate the R2 API token: create a new one scoped to the state + certs
 * buckets, poll until it propagates, then revoke any prior tokens bearing
 * the same name (best-effort — partial failures log + retry next run).
 */
export async function rotateR2Credentials(
	ctx: R2Context,
): Promise<R2Credentials> {
	logger.info('Creating new R2 API token...')
	const permissions = await resolveR2PermissionGroupIds(ctx.cfToken)
	const tokenResult = await createR2Token({
		token: ctx.cfToken,
		tokenName: TOKEN_NAME,
		accountId: ctx.accountId,
		bucketNames: [ctx.stateBucket, ctx.certsBucket],
		permissions,
	})
	const creds = deriveR2Credentials(tokenResult)

	await awaitTokenPropagation(ctx, creds)
	await revokeStaleTokens(ctx.cfToken, tokenResult.id)

	logger.info('R2 API token created and verified')
	return creds
}
