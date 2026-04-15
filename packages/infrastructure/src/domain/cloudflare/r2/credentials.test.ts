import { describe, expect, it } from 'vitest'

import { deriveR2Credentials } from './credentials.ts'

describe('deriveR2Credentials', () => {
	it('uses the token id as the access key id', () => {
		const creds = deriveR2Credentials({ id: 'tok-123', value: 'secret' })
		expect(creds.accessKeyId).toBe('tok-123')
	})

	it('derives the secret via sha256 hex of the token value', () => {
		const creds = deriveR2Credentials({ id: 'tok-123', value: 'hello' })
		expect(creds.secretAccessKey).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		)
	})
})
