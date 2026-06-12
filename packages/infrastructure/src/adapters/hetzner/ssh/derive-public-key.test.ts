import ssh2 from 'ssh2'
import { describe, expect, it } from 'vitest'

import { derivePublicKey } from './derive-public-key.ts'

const { utils: sshUtils } = ssh2

// Static, known-good ed25519 key pair. We intentionally do NOT call
// generateKeyPairSync('ed25519') here: ssh2@1.17.0 emits a malformed key in
// ~0.3% of runs, which its own parseKey then rejects - a flaky CI failure.
const ED25519_PRIVATE_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz
c2gtZWQyNTUxOQAAACBmnQYMM6D2V5xcR8KEl/hT52ySFA21ICo3hY05JIPeiAAA
AIi9+mVlvfplZQAAAAtzc2gtZWQyNTUxOQAAACBmnQYMM6D2V5xcR8KEl/hT52yS
FA21ICo3hY05JIPeiAAAAED6Oh8m2D9ae5/F3TF/VmVvamX40Pwj4WsvJnG6gEX2
r2adBgwzoPZXnFxHwoSX+FPnbJIUDbUgKjeFjTkkg96IAAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
`

const EXPECTED_PUBLIC_KEY =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGadBgwzoPZXnFxHwoSX+FPnbJIUDbUgKjeFjTkkg96I'

describe('derivePublicKey', () => {
	it('returns the OpenSSH authorized_keys line for an ed25519 private key', () => {
		const line = derivePublicKey(ED25519_PRIVATE_KEY)

		expect(line).toBe(EXPECTED_PUBLIC_KEY)
		expect(line).toMatch(/^ssh-ed25519 [A-Za-z0-9+/=]+$/)
	})

	it('matches the public material produced by ssh2 directly', () => {
		const parsed = sshUtils.parseKey(ED25519_PRIVATE_KEY)
		if (parsed instanceof Error) throw parsed
		if (Array.isArray(parsed)) throw new Error('unexpected multi-key parse')
		const expected = `${parsed.type} ${parsed.getPublicSSH().toString('base64')}`

		expect(derivePublicKey(ED25519_PRIVATE_KEY)).toBe(expected)
	})

	it('throws a clear error when the input is not a valid key', () => {
		expect(() => derivePublicKey('not a key')).toThrow(
			/Failed to parse SSH private key/,
		)
	})
})
