import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(() => Promise.resolve()),
}))

import { ensureR2Setup } from './ensure-r2.ts'

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

function notFound(): MockResponse {
	return {
		ok: false,
		status: 404,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve('not found'),
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

interface FetchOverrides {
	accountId?: string
	tokenResult?: { id: string; value: string }
	bucketExists?: boolean
	verifyResults?: Array<'ok' | '401'>
}

interface StubFetchContext {
	fetchMock: ReturnType<typeof vi.fn>
	urls: string[]
}

function stubFetch(overrides: FetchOverrides = {}): StubFetchContext {
	const accountId = overrides.accountId ?? 'acct-from-api'
	const tokenResult = overrides.tokenResult ?? {
		id: 'new-key-id',
		value: 'raw-value',
	}
	const verifyQueue = [...(overrides.verifyResults ?? ['ok'])]
	const urls: string[] = []

	const fetchMock = vi.fn(
		async (url: string | URL): Promise<MockResponse> => {
			const u = String(url)
			urls.push(u)
			if (u.endsWith('/v4/accounts')) {
				return okJson({
					success: true,
					result: [{ id: accountId }],
					errors: [],
				})
			}
			if (u.endsWith('/user/tokens/permission_groups')) {
				return okJson({
					success: true,
					result: [
						{
							id: 'read-id',
							name: 'Workers R2 Storage Bucket Item Read',
						},
						{
							id: 'write-id',
							name: 'Workers R2 Storage Bucket Item Write',
						},
					],
					errors: [],
				})
			}
			if (/\/r2\/buckets\/[^/]+$/.test(u)) {
				return overrides.bucketExists
					? okJson({
							success: true,
							result: { name: 'x' },
							errors: [],
						})
					: notFound()
			}
			if (u.endsWith('/r2/buckets')) {
				return okJson({
					success: true,
					result: { name: 'x' },
					errors: [],
				})
			}
			if (u.endsWith('/user/tokens')) {
				return okJson({
					success: true,
					result: tokenResult,
					errors: [],
				})
			}
			if (u.includes('r2.cloudflarestorage.com')) {
				const next = verifyQueue.shift() ?? 'ok'
				return next === 'ok'
					? {
							ok: true,
							status: 200,
							json: () => Promise.resolve({}),
							text: () => Promise.resolve(''),
						}
					: unauthorized()
			}
			throw new Error(`unexpected fetch: ${u}`)
		},
	)
	vi.stubGlobal('fetch', fetchMock)
	return { fetchMock, urls }
}

interface GhStubOptions {
	available?: boolean
}

function stubGh({ available = true }: GhStubOptions = {}): void {
	spawnSyncMock.mockImplementation(
		(_cmd: string, args: ReadonlyArray<string>) => {
			if (args[0] === '--version') {
				return available
					? { status: 0, stdout: 'gh version 2.x', stderr: '' }
					: { status: 1, stdout: '', stderr: 'not found' }
			}
			return { status: 0, stdout: '', stderr: '' }
		},
	)
}

const MUTATED_ENV_KEYS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const

beforeEach(() => {
	for (const key of MUTATED_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key)
	}
	vi.stubEnv('GITHUB_REPOSITORY_OWNER', 'NextNodeOrg')
	spawnSyncMock.mockReset()
})

afterEach(() => {
	for (const key of MUTATED_ENV_KEYS) {
		Reflect.deleteProperty(process.env, key)
	}
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})

describe('ensureR2Setup', () => {
	it('resolves account via GET /accounts', async () => {
		const { urls } = stubFetch()
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(result.accountId).toBe('acct-from-api')
		expect(result.endpoint).toBe(
			'https://acct-from-api.r2.cloudflarestorage.com',
		)
		expect(urls.some(u => u.endsWith('/v4/accounts'))).toBe(true)
	})

	it('ensures both state and certs buckets exist', async () => {
		const { urls } = stubFetch()
		stubGh()

		await ensureR2Setup('cf-token')

		const bucketChecks = urls.filter(u => /\/r2\/buckets\/[^/]+$/.test(u))
		expect(bucketChecks).toHaveLength(2)
		expect(bucketChecks.some(u => u.endsWith('/nextnode-state'))).toBe(true)
		expect(bucketChecks.some(u => u.endsWith('/nextnode-certs'))).toBe(true)
	})

	it('reuses env creds when they verify', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'existing-id')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'existing-secret')
		const { urls } = stubFetch({ verifyResults: ['ok'] })
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(result.accessKeyId).toBe('existing-id')
		expect(result.secretAccessKey).toBe('existing-secret')
		expect(urls.some(u => u.endsWith('/user/tokens'))).toBe(false)
	})

	it('rotates creds when env creds fail verification', async () => {
		vi.stubEnv('R2_ACCESS_KEY_ID', 'stale-id')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', 'stale-secret')
		const { urls } = stubFetch({ verifyResults: ['401', 'ok'] })
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(urls.filter(u => u.endsWith('/user/tokens'))).toHaveLength(1)
		expect(result.accessKeyId).toBe('new-key-id')
		expect(result.secretAccessKey).toHaveLength(64)
	})

	it('creates a token and stores org secrets on fresh bootstrap', async () => {
		const { urls } = stubFetch()
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(urls.filter(u => u.endsWith('/user/tokens'))).toHaveLength(1)
		expect(result.accessKeyId).toBe('new-key-id')
		const setCalls = spawnSyncMock.mock.calls.filter(
			c => c[1]?.[0] === 'secret' && c[1]?.[1] === 'set',
		)
		expect(setCalls).toHaveLength(3)
	})

	it('polls verification and gives up after max attempts', async () => {
		stubFetch({
			verifyResults: ['401', '401', '401', '401', '401'],
		})
		stubGh()

		await expect(ensureR2Setup('cf-token')).rejects.toThrow(
			'did not become active after 5 attempts',
		)
	})

	it('returns the resolved R2RuntimeConfig without mutating process.env', async () => {
		stubFetch()
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(result).toEqual({
			accountId: 'acct-from-api',
			endpoint: 'https://acct-from-api.r2.cloudflarestorage.com',
			accessKeyId: 'new-key-id',
			secretAccessKey: expect.any(String),
			stateBucket: 'nextnode-state',
			certsBucket: 'nextnode-certs',
		})
		expect(process.env['R2_ENDPOINT']).toBeUndefined()
	})

	it('skips org secret persistence when GITHUB_REPOSITORY_OWNER is unset', async () => {
		vi.stubEnv('GITHUB_REPOSITORY_OWNER', '')
		stubFetch()
		stubGh()

		await ensureR2Setup('cf-token')

		const setCalls = spawnSyncMock.mock.calls.filter(
			c => c[1]?.[0] === 'secret' && c[1]?.[1] === 'set',
		)
		expect(setCalls).toHaveLength(0)
	})

	it('warns when gh CLI is unavailable and skips storage', async () => {
		stubFetch()
		stubGh({ available: false })

		await ensureR2Setup('cf-token')

		const setCalls = spawnSyncMock.mock.calls.filter(
			c => c[1]?.[0] === 'secret' && c[1]?.[1] === 'set',
		)
		expect(setCalls).toHaveLength(0)
	})
})
