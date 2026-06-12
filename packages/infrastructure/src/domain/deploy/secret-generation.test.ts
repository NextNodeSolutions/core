import { describe, expect, it } from 'vitest'

import { generateSecretValue } from './secret-generation.ts'

// A deterministic byte source: hands out the given bytes one at a time so the
// encoding logic can be asserted exactly (the real source is crypto.randomBytes).
function bytesFrom(bytes: ReadonlyArray<number>): () => number {
	let index = 0
	return () => {
		const byte = bytes[index]
		if (byte === undefined) {
			throw new Error('byte source exhausted - test fed too few bytes')
		}
		index += 1
		return byte
	}
}

describe('generateSecretValue', () => {
	it('maps bytes onto the base64url alphabet for a token', () => {
		// 0->A, 1->B, 26->a, 52->0, 62->-, 63->_ (base64url order)
		const secret = generateSecretValue(
			{ name: 'T', generate: 'token', length: 6 },
			bytesFrom([0, 1, 26, 52, 62, 63]),
		)

		expect(secret).toBe('ABa0-_')
	})

	it('draws a password from the alphanumeric alphabet, rejecting biased bytes', () => {
		// alphabet is 62 chars: 0->A, 61->9. Bytes >= 248 (the largest multiple
		// of 62 in a byte) are discarded to avoid modulo bias, so 248 is skipped.
		const secret = generateSecretValue(
			{ name: 'P', generate: 'password', length: 2 },
			bytesFrom([0, 248, 61]),
		)

		expect(secret).toBe('A9')
	})

	it('emits exactly `length` characters, all within the token alphabet', () => {
		const length = 43
		const secret = generateSecretValue({
			name: 'JWT_SECRET',
			generate: 'token',
			length,
		})

		expect(secret).toHaveLength(length)
		expect(secret).toMatch(/^[A-Za-z0-9_-]+$/)
	})

	it('emits only alphanumeric characters for a password', () => {
		const secret = generateSecretValue({
			name: 'DB_PASSWORD',
			generate: 'password',
			length: 24,
		})

		expect(secret).toHaveLength(24)
		expect(secret).toMatch(/^[A-Za-z0-9]+$/)
	})
})
