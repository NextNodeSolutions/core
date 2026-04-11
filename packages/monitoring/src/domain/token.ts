import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

export const TOKEN_PREFIX = 'nn_live_'
export const TOKEN_RANDOM_BYTES = 32
const TOKEN_HASH_HEX_LENGTH = 64

export interface GeneratedToken {
	readonly plaintext: string
	readonly hash: string
}

/**
 * Format a token plaintext + hash from 32 raw random bytes.
 *
 * Pure: caller owns the random source (adapter/cli layer).
 * Same input always produces the same output — tests can pass fixed bytes.
 */
export function formatToken(randomBytes: Uint8Array): GeneratedToken {
	if (randomBytes.length !== TOKEN_RANDOM_BYTES) {
		throw new Error(
			`Token requires exactly ${TOKEN_RANDOM_BYTES} random bytes, got ${randomBytes.length}`,
		)
	}
	const plaintext = `${TOKEN_PREFIX}${Buffer.from(randomBytes).toString('base64url')}`
	const hash = hashToken(plaintext)
	return { plaintext, hash }
}

export function hashToken(plaintext: string): string {
	return createHash('sha256').update(plaintext).digest('hex')
}

/**
 * Constant-time comparison of a plaintext token against a stored hash.
 *
 * Returns false if the hash shape is unexpected (wrong length). Uses
 * `timingSafeEqual` to prevent timing side-channels on the critical auth path.
 */
export function verifyToken(plaintext: string, expectedHash: string): boolean {
	if (expectedHash.length !== TOKEN_HASH_HEX_LENGTH) return false
	const actualHash = hashToken(plaintext)
	return timingSafeEqual(
		Buffer.from(actualHash, 'hex'),
		Buffer.from(expectedHash, 'hex'),
	)
}
