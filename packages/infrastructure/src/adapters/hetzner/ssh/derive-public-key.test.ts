import ssh2 from 'ssh2'
import { describe, expect, it } from 'vitest'

import { derivePublicKey } from './derive-public-key.ts'

const { utils: sshUtils } = ssh2

describe('derivePublicKey', () => {
	it('returns the OpenSSH authorized_keys line for an ed25519 private key', () => {
		const kp = sshUtils.generateKeyPairSync('ed25519')

		const line = derivePublicKey(kp.private)

		expect(line).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+$/)
	})

	it('matches the public material produced by ssh2 directly', () => {
		const kp = sshUtils.generateKeyPairSync('ed25519')
		const parsed = sshUtils.parseKey(kp.private)
		if (parsed instanceof Error) throw parsed
		if (Array.isArray(parsed)) throw new Error('unexpected multi-key parse')
		const expected = `${parsed.type} ${parsed.getPublicSSH().toString('base64')}`

		expect(derivePublicKey(kp.private)).toBe(expected)
	})

	it('throws a clear error when the input is not a valid key', () => {
		expect(() => derivePublicKey('not a key')).toThrow(
			/Failed to parse SSH private key/,
		)
	})
})
