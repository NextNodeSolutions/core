import { randomBytes } from 'node:crypto'

import type { GeneratedSecretConfig, SecretGenerator } from '#/config/types.ts'

// base64url alphabet (64 chars): index = byte & 63, so no value is ever
// rejected and there is no modulo bias. Right shape for JWT/HS256 keys.
const TOKEN_ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// alphanumeric alphabet (62 chars): not a power of two, so bytes are
// rejection-sampled (see generatorByteCeiling) to keep the draw uniform.
const PASSWORD_ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

const ALPHABETS: Record<SecretGenerator, string> = {
	token: TOKEN_ALPHABET,
	password: PASSWORD_ALPHABET,
}

const BYTE_RANGE = 256
const BYTE_BATCH = 64

/**
 * The exclusive upper bound on a usable byte for a given alphabet: the largest
 * multiple of `size` that fits in a byte. Bytes at or above it would skew the
 * distribution toward the low indices (modulo bias), so they are discarded. For
 * a power-of-two alphabet (token = 64) this equals 256 — nothing is discarded.
 */
function generatorByteCeiling(size: number): number {
	return BYTE_RANGE - (BYTE_RANGE % size)
}

/**
 * Build the default cryptographic byte source: `crypto.randomBytes` drawn in
 * batches so a 43-char token does not cost 43 syscalls. Injected in tests with
 * a deterministic sequence so the alphabet mapping can be asserted exactly.
 */
function defaultByteSource(): () => number {
	let buffer = randomBytes(BYTE_BATCH)
	let offset = 0
	return () => {
		if (offset >= buffer.length) {
			buffer = randomBytes(BYTE_BATCH)
			offset = 0
		}
		const byte = buffer[offset]!
		offset += 1
		return byte
	}
}

/**
 * Generate a random secret value of exactly `spec.length` characters drawn
 * uniformly from the generator's alphabet. Pure given `nextByte` (defaulting to
 * crypto) — the imperative shell (`ensureGeneratedSecrets`) decides whether to
 * call it; this only computes.
 */
export function generateSecretValue(
	spec: GeneratedSecretConfig,
	nextByte: () => number = defaultByteSource(),
): string {
	const alphabet = ALPHABETS[spec.generate]
	const ceiling = generatorByteCeiling(alphabet.length)
	const chars: string[] = []
	while (chars.length < spec.length) {
		const byte = nextByte()
		if (byte >= ceiling) continue
		chars.push(alphabet[byte % alphabet.length]!)
	}
	return chars.join('')
}
