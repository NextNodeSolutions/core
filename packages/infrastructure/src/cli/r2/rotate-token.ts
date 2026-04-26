import { resolveR2PermissionGroupIds } from '#/adapters/cloudflare/permission-groups.ts'
import { createR2Token } from '#/adapters/cloudflare/r2/tokens.ts'
import { deriveR2Credentials } from '#/domain/cloudflare/r2/credentials.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { R2Context } from './context.ts'
import { awaitTokenPropagation, revokeStaleTokens } from './token-lifecycle.ts'

const logger = createLogger()

export const TOKEN_NAME = 'nextnode-infrastructure-r2'

export interface R2Credentials {
	readonly accessKeyId: string
	readonly secretAccessKey: string
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

	await awaitTokenPropagation({
		accountId: ctx.accountId,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		probeBucket: ctx.stateBucket,
	})
	await revokeStaleTokens(ctx.cfToken, TOKEN_NAME, tokenResult.id)

	logger.info('R2 API token created and verified')
	return creds
}
