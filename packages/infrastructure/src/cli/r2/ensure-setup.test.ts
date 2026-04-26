import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }))
vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(() => Promise.resolve()),
}))

import type { MockResponse } from '#/test-fetch.ts'
import { notFound, okJson, unauthorized } from '#/test-fetch.ts'

import { ensureR2Setup } from './ensure-setup.ts'

interface ListedTokenFixture {
	readonly id: string
	readonly name: string
	readonly status: string
}

interface FetchOverrides {
	accountId?: string
	tokenResult?: { id: string; value: string }
	bucketExists?: boolean
	verifyResults?: Array<'ok' | '401'>
	existingTokens?: ReadonlyArray<ListedTokenFixture>
	deleteFailsFor?: ReadonlyArray<string>
}

interface StubFetchContext {
	fetchMock: ReturnType<typeof vi.fn>
	urls: string[]
	deletedTokenIds: string[]
}

const PERMISSION_GROUPS_BODY = {
	success: true,
	result: [
		{ id: 'read-id', name: 'Workers R2 Storage Bucket Item Read' },
		{ id: 'write-id', name: 'Workers R2 Storage Bucket Item Write' },
	],
	errors: [],
}

interface RouterContext {
	readonly url: string
	readonly method: string
	readonly overrides: FetchOverrides
	readonly verifyQueue: Array<'ok' | '401'>
	readonly deletedTokenIds: string[]
}

function routeBucketEndpoints(ctx: RouterContext): MockResponse | undefined {
	if (/\/r2\/buckets\/[^/]+$/.test(ctx.url)) {
		return ctx.overrides.bucketExists
			? okJson({ success: true, result: { name: 'x' }, errors: [] })
			: notFound()
	}
	if (ctx.url.endsWith('/r2/buckets')) {
		return okJson({ success: true, result: { name: 'x' }, errors: [] })
	}
	return undefined
}

function routeTokenEndpoints(ctx: RouterContext): MockResponse | undefined {
	const byId = /\/user\/tokens\/([^/]+)$/.exec(ctx.url)
	if (byId && ctx.method === 'DELETE') {
		const id = byId[1] ?? ''
		if (ctx.overrides.deleteFailsFor?.includes(id)) {
			return {
				ok: false,
				status: 500,
				json: () => Promise.resolve({}),
				text: () => Promise.resolve('boom'),
			}
		}
		ctx.deletedTokenIds.push(id)
		return okJson({ success: true, result: { id }, errors: [] })
	}
	if (ctx.url.endsWith('/user/tokens')) {
		const tokenResult = ctx.overrides.tokenResult ?? {
			id: 'new-key-id',
			value: 'raw-value',
		}
		if (ctx.method === 'POST') {
			return okJson({
				success: true,
				result: tokenResult,
				errors: [],
			})
		}
		return okJson({
			success: true,
			result: ctx.overrides.existingTokens ?? [],
			errors: [],
		})
	}
	return undefined
}

function routeS3Endpoint(ctx: RouterContext): MockResponse | undefined {
	if (!ctx.url.includes('r2.cloudflarestorage.com')) return undefined
	const next = ctx.verifyQueue.shift() ?? 'ok'
	if (next === 'ok') {
		return {
			ok: true,
			status: 200,
			json: () => Promise.resolve({}),
			text: () => Promise.resolve(''),
		}
	}
	return unauthorized()
}

function stubFetch(overrides: FetchOverrides = {}): StubFetchContext {
	const accountId = overrides.accountId ?? 'acct-from-api'
	const verifyQueue = [...(overrides.verifyResults ?? ['ok'])]
	const urls: string[] = []
	const deletedTokenIds: string[] = []

	const fetchMock = vi.fn(
		async (
			url: string | URL,
			init?: { method?: string },
		): Promise<MockResponse> => {
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
				return okJson(PERMISSION_GROUPS_BODY)
			}
			const ctx: RouterContext = {
				url: u,
				method: init?.method ?? 'GET',
				overrides,
				verifyQueue,
				deletedTokenIds,
			}
			const routed =
				routeBucketEndpoints(ctx) ??
				routeTokenEndpoints(ctx) ??
				routeS3Endpoint(ctx)
			if (routed) return routed
			throw new Error(`unexpected fetch: ${u}`)
		},
	)
	vi.stubGlobal('fetch', fetchMock)
	return { fetchMock, urls, deletedTokenIds }
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

		const tokenCreates = urls.filter(u => u.endsWith('/user/tokens'))
		expect(tokenCreates).toHaveLength(2) // POST (create) + GET (list for cleanup)
		expect(result.accessKeyId).toBe('new-key-id')
		expect(result.secretAccessKey).toHaveLength(64)
	})

	it('continues revoking remaining tokens when one delete fails (best-effort)', async () => {
		const { deletedTokenIds } = stubFetch({
			verifyResults: ['ok'],
			existingTokens: [
				{
					id: 'old-1',
					name: 'nextnode-infrastructure-r2',
					status: 'active',
				},
				{
					id: 'old-2',
					name: 'nextnode-infrastructure-r2',
					status: 'active',
				},
				{
					id: 'new-key-id',
					name: 'nextnode-infrastructure-r2',
					status: 'active',
				},
			],
			deleteFailsFor: ['old-1'],
		})
		stubGh()

		await expect(ensureR2Setup('cf-token')).resolves.toBeDefined()
		expect(deletedTokenIds).toContain('old-2')
		expect(deletedTokenIds).not.toContain('old-1')
	})

	it('revokes stale tokens with the same name after rotating', async () => {
		const { deletedTokenIds } = stubFetch({
			verifyResults: ['ok'],
			existingTokens: [
				{
					id: 'old-1',
					name: 'nextnode-infrastructure-r2',
					status: 'active',
				},
				{
					id: 'new-key-id',
					name: 'nextnode-infrastructure-r2',
					status: 'active',
				},
				{ id: 'other', name: 'unrelated', status: 'active' },
			],
		})
		stubGh()

		await ensureR2Setup('cf-token')

		expect(deletedTokenIds).toEqual(['old-1'])
	})

	it('creates a token and stores org secrets on fresh bootstrap', async () => {
		const { urls } = stubFetch()
		stubGh()

		const result = await ensureR2Setup('cf-token')

		expect(urls.filter(u => u.endsWith('/user/tokens'))).toHaveLength(2) // POST (create) + GET (list for cleanup)
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

	it('returns the resolved InfraStorageRuntimeConfig without mutating process.env', async () => {
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
