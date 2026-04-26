import { httpError, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveAccountId } from './accounts.ts'

const TOKEN = 'cf-token'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('resolveAccountId', () => {
	it('returns the single account id', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: [{ id: 'acct-1', name: 'acme' }],
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const id = await resolveAccountId(TOKEN)
		expect(id).toBe('acct-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/accounts',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		)
	})

	it('throws when zero accounts are returned', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					okJson({ success: true, result: [], errors: [] }),
				),
		)
		await expect(resolveAccountId(TOKEN)).rejects.toThrow(
			'token grants access to no accounts',
		)
	})

	it('throws when multiple accounts are returned', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: [
						{ id: 'a', name: 'one' },
						{ id: 'b', name: 'two' },
					],
					errors: [],
				}),
			),
		)
		await expect(resolveAccountId(TOKEN)).rejects.toThrow(
			'set CLOUDFLARE_ACCOUNT_ID to disambiguate',
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)
		await expect(resolveAccountId(TOKEN)).rejects.toThrow(
			'Cloudflare API returned 403',
		)
	})

	it('throws when API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: [],
					errors: [{ code: 9999, message: 'nope' }],
				}),
			),
		)
		await expect(resolveAccountId(TOKEN)).rejects.toThrow('[9999] nope')
	})
})
