import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadR2Runtime } from './load-runtime.ts'

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

function okEmpty(): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(''),
	}
}

function unauthorized(): MockResponse {
	return {
		ok: false,
		status: 401,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve('InvalidAccessKeyId'),
	}
}

interface StubOptions {
	readonly accountId?: string
	readonly verifyStatus?: 'ok' | '401'
}

interface StubContext {
	readonly fetchMock: ReturnType<typeof vi.fn>
	readonly urls: string[]
}

function stubFetch(options: StubOptions = {}): StubContext {
	const accountId = options.accountId ?? 'acct-from-api'
	const verifyStatus = options.verifyStatus ?? 'ok'
	const urls: string[] = []

	const fetchMock = vi.fn(
		async (input: string | URL): Promise<MockResponse> => {
			const url = String(input)
			urls.push(url)
			if (url.endsWith('/v4/accounts')) {
				return okJson({
					success: true,
					result: [{ id: accountId }],
					errors: [],
				})
			}
			if (url.includes('r2.cloudflarestorage.com')) {
				return verifyStatus === 'ok' ? okEmpty() : unauthorized()
			}
			throw new Error(`unexpected fetch: ${url}`)
		},
	)
	vi.stubGlobal('fetch', fetchMock)
	return { fetchMock, urls }
}

const MUTATED_ENV_KEYS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const

beforeEach(() => {
	for (const key of MUTATED_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key)
	}
})

afterEach(() => {
	for (const key of MUTATED_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key)
	}
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('loadR2Runtime', () => {
	it('returns runtime config from env creds after verifying them', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'ak')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'sk')
		const { urls } = stubFetch({ verifyStatus: 'ok' })

		const result = await loadR2Runtime('cf-token')

		expect(result).toEqual({
			accountId: 'acct-from-api',
			endpoint: 'https://acct-from-api.r2.cloudflarestorage.com',
			accessKeyId: 'ak',
			secretAccessKey: 'sk',
			stateBucket: 'nextnode-state',
			certsBucket: 'nextnode-certs',
		})
		expect(urls.some(u => u.endsWith('/v4/accounts'))).toBe(true)
		expect(urls.some(u => u.includes('r2.cloudflarestorage.com'))).toBe(
			true,
		)
	})

	it('does not create buckets or tokens, and does not call gh secret set', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'ak')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'sk')
		const { urls } = stubFetch({ verifyStatus: 'ok' })

		await loadR2Runtime('cf-token')

		expect(urls.some(u => u.includes('/r2/buckets'))).toBe(false)
		expect(urls.some(u => u.endsWith('/user/tokens'))).toBe(false)
	})

	it('throws when R2_ACCESS_KEY_ID is missing', async () => {
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'sk')
		stubFetch()

		await expect(loadR2Runtime('cf-token')).rejects.toThrow(
			'R2_ACCESS_KEY_ID env var is required',
		)
	})

	it('throws when R2_SECRET_ACCESS_KEY is missing', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'ak')
		stubFetch()

		await expect(loadR2Runtime('cf-token')).rejects.toThrow(
			'R2_SECRET_ACCESS_KEY env var is required',
		)
	})

	it('fails loud when env creds are stale (no rotation at deploy time)', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'stale')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'stale')
		stubFetch({ verifyStatus: '401' })

		await expect(loadR2Runtime('cf-token')).rejects.toThrow(
			/stale.*Re-run provision/,
		)
	})
})
