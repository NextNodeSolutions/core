import { describe, expect, it } from 'vitest'

import { verifyTeardownConfirmation } from './verify-teardown-confirmation.ts'

describe('verifyTeardownConfirmation', () => {
	it('returns without throwing when confirmation matches project name', () => {
		expect(() =>
			verifyTeardownConfirmation('acme-web', 'acme-web'),
		).not.toThrow()
	})

	it('throws when confirmation is undefined', () => {
		expect(() => verifyTeardownConfirmation('acme-web', undefined)).toThrow(
			/TEARDOWN_CONFIRM is required/,
		)
	})

	it('throws when confirmation is empty', () => {
		expect(() => verifyTeardownConfirmation('acme-web', '')).toThrow(
			/TEARDOWN_CONFIRM is required/,
		)
	})

	it('throws when confirmation does not match', () => {
		expect(() =>
			verifyTeardownConfirmation('acme-web', 'wrong-name'),
		).toThrow(/does not match project name/)
	})

	it('is case-sensitive', () => {
		expect(() =>
			verifyTeardownConfirmation('acme-web', 'Acme-Web'),
		).toThrow(/does not match/)
	})
})
