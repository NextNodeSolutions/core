import { httpError, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { updatePagesEnvVars } from './env.ts'

import type { FetchImpl } from '#/test-fetch.ts'

const TOKEN = 'cf-token-123'
const ACCOUNT = 'acct-abc'
const PROJECT = 'my-site'

function extractBody(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>): unknown {
	const [call] = fetchMock.mock.calls
	if (!call) throw new Error('fetch was not called')
	const body = call[1]?.body
	if (typeof body !== 'string') throw new Error('body is not a string')
	return JSON.parse(body)
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('updatePagesEnvVars', () => {
	it('PATCHes production deployment config with computed and secret env vars', async () => {
		const fetchMock = vi
			.fn<FetchImpl>()
			.mockResolvedValue(
				okJson({ success: true, result: {}, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		await updatePagesEnvVars(
			{ accountId: ACCOUNT, projectName: PROJECT, token: TOKEN },
			{ SITE_URL: 'https://example.com' },
			{ RESEND_API_KEY: 'resend-123' },
		)

		expect(fetchMock).toHaveBeenCalledOnce()
		expect(fetchMock.mock.calls[0]?.[0]).toContain(
			`/pages/projects/${PROJECT}`,
		)
		expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
		expect(extractBody(fetchMock)).toStrictEqual({
			deployment_configs: {
				production: {
					env_vars: {
						SITE_URL: {
							type: 'plain_text',
							value: 'https://example.com',
						},
						RESEND_API_KEY: {
							type: 'secret_text',
							value: 'resend-123',
						},
					},
				},
			},
		})
	})

	it('sends only computed vars when no secrets', async () => {
		const fetchMock = vi
			.fn<FetchImpl>()
			.mockResolvedValue(
				okJson({ success: true, result: {}, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		await updatePagesEnvVars(
			{ accountId: ACCOUNT, projectName: PROJECT, token: TOKEN },
			{ SITE_URL: 'https://example.com' },
			{},
		)

		expect(extractBody(fetchMock)).toStrictEqual({
			deployment_configs: {
				production: {
					env_vars: {
						SITE_URL: {
							type: 'plain_text',
							value: 'https://example.com',
						},
					},
				},
			},
		})
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(
			updatePagesEnvVars(
				{ accountId: ACCOUNT, projectName: PROJECT, token: TOKEN },
				{},
				{},
			),
		).rejects.toThrow('Cloudflare API returned 403')
	})

	it('throws on API-level failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>().mockResolvedValue(
				okJson({
					success: false,
					result: null,
					errors: [{ code: 1000, message: 'bad request' }],
				}),
			),
		)

		await expect(
			updatePagesEnvVars(
				{ accountId: ACCOUNT, projectName: PROJECT, token: TOKEN },
				{},
				{},
			),
		).rejects.toThrow('[1000] bad request')
	})
})
