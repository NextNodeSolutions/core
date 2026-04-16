import { afterEach, describe, expect, it, vi } from 'vitest'

import { deleteTailnetDevicesByHostname, mintAuthkey } from './oauth.ts'

const CLIENT_SECRET = 'tskey-client-abc123'

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

function httpError(status: number, body: string): MockResponse {
	return {
		ok: false,
		status,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(body),
	}
}

function callAt(
	mock: ReturnType<typeof vi.fn>,
	index: number,
): [string, RequestInit] {
	const call = mock.mock.calls[index]
	if (!call) throw new Error(`No call recorded at index ${index}`)
	return [call[0], call[1]]
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('mintAuthkey', () => {
	it('exchanges client secret then creates tagged authkey', async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(okJson({ access_token: 'bearer-123' }))
			.mockResolvedValueOnce(
				okJson({
					key: 'tskey-auth-xyz',
					expires: '2030-01-01T00:00:00Z',
				}),
			)
		vi.stubGlobal('fetch', mock)

		const result = await mintAuthkey(
			CLIENT_SECRET,
			['tag:ci'],
			600,
			'probe',
		)

		expect(result).toStrictEqual({
			key: 'tskey-auth-xyz',
			expires: '2030-01-01T00:00:00Z',
		})

		const [tokenUrl, tokenInit] = callAt(mock, 0)
		expect(tokenUrl).toBe('https://api.tailscale.com/api/v2/oauth/token')
		expect(tokenInit.method).toBe('POST')
		expect(tokenInit.body).toBe('grant_type=client_credentials')
		expect(tokenInit.headers).toStrictEqual(
			expect.objectContaining({
				Authorization: expect.stringMatching(/^Basic /),
			}),
		)

		const [keyUrl, keyInit] = callAt(mock, 1)
		expect(keyUrl).toBe('https://api.tailscale.com/api/v2/tailnet/-/keys')
		expect(keyInit.method).toBe('POST')
		expect(keyInit.headers).toStrictEqual(
			expect.objectContaining({ Authorization: 'Bearer bearer-123' }),
		)
		const body: unknown = JSON.parse(String(keyInit.body))
		expect(body).toStrictEqual({
			capabilities: {
				devices: {
					create: {
						reusable: false,
						ephemeral: false,
						preauthorized: true,
						tags: ['tag:ci'],
					},
				},
			},
			expirySeconds: 600,
			description: 'probe',
		})
	})

	it('throws when tags array is empty', async () => {
		await expect(
			mintAuthkey(CLIENT_SECRET, [], 600, 'probe'),
		).rejects.toThrow('at least one tag')
	})

	it('throws on token exchange HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(401, 'invalid_client')),
		)

		await expect(
			mintAuthkey(CLIENT_SECRET, ['tag:ci'], 600, 'probe'),
		).rejects.toThrow(/OAuth token exchange.*401.*invalid_client/)
	})

	it('throws when token response missing access_token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({})))

		await expect(
			mintAuthkey(CLIENT_SECRET, ['tag:ci'], 600, 'probe'),
		).rejects.toThrow('missing access_token')
	})

	it('throws on create authkey HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
				.mockResolvedValueOnce(httpError(403, 'tag not allowed')),
		)

		await expect(
			mintAuthkey(CLIENT_SECRET, ['tag:ci'], 600, 'probe'),
		).rejects.toThrow(/create authkey.*403.*tag not allowed/)
	})

	it('throws when create authkey response missing fields', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
				.mockResolvedValueOnce(okJson({ key: 'only-key' })),
		)

		await expect(
			mintAuthkey(CLIENT_SECRET, ['tag:ci'], 600, 'probe'),
		).rejects.toThrow('invalid response shape')
	})
})

describe('deleteTailnetDevicesByHostname', () => {
	it('deletes every device matching the hostname and returns count', async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
			.mockResolvedValueOnce(
				okJson({
					devices: [
						{ id: '111', hostname: 'hetzner-e2e' },
						{ id: '222', hostname: 'other-project' },
						{ id: '333', hostname: 'hetzner-e2e' },
					],
				}),
			)
			.mockResolvedValueOnce(okJson({}))
			.mockResolvedValueOnce(okJson({}))
		vi.stubGlobal('fetch', mock)

		const count = await deleteTailnetDevicesByHostname(
			CLIENT_SECRET,
			'hetzner-e2e',
		)

		expect(count).toBe(2)
		const [url1, init1] = callAt(mock, 2)
		expect(url1).toBe('https://api.tailscale.com/api/v2/device/111')
		expect(init1.method).toBe('DELETE')
		const [url2, init2] = callAt(mock, 3)
		expect(url2).toBe('https://api.tailscale.com/api/v2/device/333')
		expect(init2.method).toBe('DELETE')
	})

	it('returns 0 when no device matches', async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
			.mockResolvedValueOnce(
				okJson({ devices: [{ id: '111', hostname: 'other' }] }),
			)
		vi.stubGlobal('fetch', mock)

		const count = await deleteTailnetDevicesByHostname(
			CLIENT_SECRET,
			'hetzner-e2e',
		)

		expect(count).toBe(0)
		expect(mock).toHaveBeenCalledTimes(2)
	})

	it('throws on list devices HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
				.mockResolvedValueOnce(httpError(401, 'forbidden')),
		)

		await expect(
			deleteTailnetDevicesByHostname(CLIENT_SECRET, 'x'),
		).rejects.toThrow(/list devices.*401.*forbidden/)
	})

	it('throws on delete HTTP error mid-way', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(okJson({ access_token: 'bearer' }))
				.mockResolvedValueOnce(
					okJson({
						devices: [
							{ id: '111', hostname: 'x' },
							{ id: '222', hostname: 'x' },
						],
					}),
				)
				.mockResolvedValueOnce(okJson({}))
				.mockResolvedValueOnce(httpError(500, 'boom')),
		)

		await expect(
			deleteTailnetDevicesByHostname(CLIENT_SECRET, 'x'),
		).rejects.toThrow(/delete device 222.*500.*boom/)
	})
})
