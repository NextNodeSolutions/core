import { describe, expect, it } from 'vitest'

import {
	formatToken,
	hashToken,
	TOKEN_PREFIX,
	TOKEN_RANDOM_BYTES,
	verifyToken,
} from './token.ts'

const zeroBytes = new Uint8Array(TOKEN_RANDOM_BYTES)
const onesBytes = new Uint8Array(TOKEN_RANDOM_BYTES).fill(0xff)
// Known SHA-256 of the empty string — see RFC 6234 test vectors.
const EMPTY_STRING_SHA256 =
	'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('formatToken', () => {
	it('prefixes the plaintext with the public scheme marker', () => {
		const token = formatToken(zeroBytes)

		expect(token.plaintext.startsWith(TOKEN_PREFIX)).toBe(true)
	})

	it('encodes 32 zero bytes as base64url with 43 chars', () => {
		const token = formatToken(zeroBytes)
		const payload = token.plaintext.slice(TOKEN_PREFIX.length)

		expect(payload).toBe('A'.repeat(43))
	})

	it('produces a 64-char hex hash', () => {
		const token = formatToken(zeroBytes)

		expect(token.hash).toHaveLength(64)
		expect(/^[0-9a-f]{64}$/.test(token.hash)).toBe(true)
	})

	it('is deterministic — same bytes produce the same plaintext and hash', () => {
		const a = formatToken(zeroBytes)
		const b = formatToken(zeroBytes)

		expect(a).toEqual(b)
	})

	it('produces distinct outputs for distinct inputs', () => {
		const a = formatToken(zeroBytes)
		const b = formatToken(onesBytes)

		expect(a.plaintext).not.toBe(b.plaintext)
		expect(a.hash).not.toBe(b.hash)
	})

	it.each([0, 1, 16, 31, 33, 64])(
		'throws when given %i bytes instead of 32',
		length => {
			expect(() => formatToken(new Uint8Array(length))).toThrow(
				`Token requires exactly ${TOKEN_RANDOM_BYTES} random bytes, got ${length}`,
			)
		},
	)
})

describe('hashToken', () => {
	it('matches the RFC 6234 SHA-256 vector for the empty string', () => {
		expect(hashToken('')).toBe(EMPTY_STRING_SHA256)
	})

	it('is deterministic', () => {
		expect(hashToken('nn_live_abc')).toBe(hashToken('nn_live_abc'))
	})

	it('differs across distinct inputs', () => {
		expect(hashToken('a')).not.toBe(hashToken('b'))
	})
})

describe('verifyToken', () => {
	it('accepts the correct plaintext for a given hash', () => {
		const token = formatToken(zeroBytes)

		expect(verifyToken(token.plaintext, token.hash)).toBe(true)
	})

	it('rejects a plaintext that hashes to a different value', () => {
		const token = formatToken(zeroBytes)

		expect(verifyToken('nn_live_wrong', token.hash)).toBe(false)
	})

	it('rejects a hash of the wrong length without throwing', () => {
		const token = formatToken(zeroBytes)

		expect(verifyToken(token.plaintext, 'deadbeef')).toBe(false)
		expect(verifyToken(token.plaintext, '')).toBe(false)
		expect(verifyToken(token.plaintext, `${token.hash}00`)).toBe(false)
	})

	it('rejects plaintexts that differ only in the payload', () => {
		const tokenA = formatToken(zeroBytes)
		const tokenB = formatToken(onesBytes)

		expect(verifyToken(tokenA.plaintext, tokenB.hash)).toBe(false)
		expect(verifyToken(tokenB.plaintext, tokenA.hash)).toBe(false)
	})
})
