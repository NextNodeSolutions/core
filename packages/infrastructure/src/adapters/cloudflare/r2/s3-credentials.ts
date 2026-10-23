import { createHash } from 'node:crypto'

import { object, string } from 'valibot'

import { cloudflareGet, readResult } from '../api.ts'

import type { CloudflareApiAccess } from '../api.ts'
import type { S3Credentials } from './s3-signer.ts'

// An API token signs S3 requests as a key pair: its id is the access key id,
// the SHA-256 hex of its value the secret access key. The id comes from the
// verify endpoint of the token's owner: the account for an account-owned
// token, the user otherwise.
const tokenSchema = object({ id: string() })

async function verifiedTokenId(
	access: CloudflareApiAccess,
	path: string,
): Promise<string | undefined> {
	const label = `Verify the Cloudflare API token at ${path}`
	const envelope = await cloudflareGet(access, path, label)
	if (!envelope.success) return undefined
	return readResult(envelope, tokenSchema, label).id
}

/** The S3 key pair of the CI token, for R2's S3 API. */
export async function deriveS3Credentials(
	access: CloudflareApiAccess,
): Promise<S3Credentials> {
	const accessKeyId =
		(await verifiedTokenId(
			access,
			`/accounts/${access.accountId}/tokens/verify`,
		)) ?? (await verifiedTokenId(access, '/user/tokens/verify'))
	if (!accessKeyId) {
		throw new Error(
			'CLOUDFLARE_API_TOKEN could not be verified as an account token or as a user token, so its id, the R2 S3 access key id, is unknown - check that the token is active',
		)
	}
	return {
		accessKeyId,
		secretAccessKey: createHash('sha256')
			.update(access.apiToken)
			.digest('hex'),
	}
}
