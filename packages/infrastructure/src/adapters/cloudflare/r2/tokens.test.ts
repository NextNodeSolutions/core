import { afterEach, describe, expect, it, vi } from 'vitest'

import { createR2Token } from './tokens.ts'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

const INPUT = {
	token: 'parent-tok',
	tokenName: 'nextnode-r2',
	accountId: 'acct',
	bucketNames: ['nextnode-state', 'nextnode-certs'] as const,
	permissions: { readId: 'read-id', writeId: 'write-id' },
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('createR2Token', () => {
	it('POSTs the policy body and returns {id,value}', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { id: 'new-id', value: 'raw-secret' },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const result = await createR2Token({ ...INPUT })
		expect(result).toEqual({ id: 'new-id', value: 'raw-secret' })
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/user/tokens',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					Authorization: 'Bearer parent-tok',
				}),
			}),
		)
		const call = fetchMock.mock.calls[0]
		if (!call) throw new Error('expected fetch call')
		const body: unknown = JSON.parse(call[1].body)
		expect(body).toEqual({
			name: 'nextnode-r2',
			policies: [
				{
					effect: 'allow',
					permission_groups: [{ id: 'read-id' }, { id: 'write-id' }],
					resources: {
						'com.cloudflare.edge.r2.bucket.acct_default_nextnode-state':
							'*',
						'com.cloudflare.edge.r2.bucket.acct_default_nextnode-certs':
							'*',
					},
				},
			],
		})
	})

	it('throws when API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: {},
					errors: [{ code: 7003, message: 'invalid policy' }],
				}),
			),
		)
		await expect(createR2Token({ ...INPUT })).rejects.toThrow(
			'[7003] invalid policy',
		)
	})
})
