import { httpError, notFound, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ensureR2Bucket } from './buckets.ts'

const INPUT = {
	token: 'tok',
	accountId: 'acct',
	bucketName: 'nextnode-state',
	locationHint: 'weur',
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('ensureR2Bucket', () => {
	it('returns false when the bucket already exists', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { name: 'nextnode-state' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const created = await ensureR2Bucket(INPUT)
		expect(created).toBe(false)
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/nextnode-state',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer tok',
				}),
			}),
		)
	})

	it('creates the bucket on 404 with the provided location hint', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(notFound())
			.mockResolvedValueOnce(
				okJson({
					success: true,
					result: { name: 'nextnode-state' },
					errors: [],
				}),
			)
		vi.stubGlobal('fetch', fetchMock)

		const created = await ensureR2Bucket(INPUT)
		expect(created).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					name: 'nextnode-state',
					locationHint: 'weur',
				}),
			}),
		)
	})

	it('throws when the check returns a non-404 error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValueOnce(httpError(500, 'server err')),
		)
		await expect(ensureR2Bucket(INPUT)).rejects.toThrow(
			'bucket check for "nextnode-state" returned 500',
		)
	})

	it('throws when create fails HTTP', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(notFound())
				.mockResolvedValueOnce(httpError(403, 'denied')),
		)
		await expect(ensureR2Bucket(INPUT)).rejects.toThrow(
			'Cloudflare API returned 403',
		)
	})

	it('throws when create returns success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(notFound())
				.mockResolvedValueOnce(
					okJson({
						success: false,
						result: {},
						errors: [{ code: 10004, message: 'bucket exists' }],
					}),
				),
		)
		await expect(ensureR2Bucket(INPUT)).rejects.toThrow(
			'[10004] bucket exists',
		)
	})
})
