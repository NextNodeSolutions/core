import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(() => Promise.resolve()),
}))

const fakeR2State = new Map<string, string>()

vi.mock('#/adapters/r2/client.ts', () => ({
	R2Client: vi.fn(() => ({
		get: vi.fn(async (key: string) => {
			const body = fakeR2State.get(key)
			return body === undefined ? null : { body, etag: 'etag' }
		}),
		put: vi.fn(async (key: string, body: string) => {
			fakeR2State.set(key, body)
			return 'etag'
		}),
		delete: vi.fn(),
		exists: vi.fn(),
		deleteByPrefix: vi.fn(),
	})),
}))

import type { MockResponse } from '#/test-fetch.ts'
import { notFound, okJson, unauthorized } from '#/test-fetch.ts'

import { ensureR2Service } from './ensure.ts'

const PERMISSION_GROUPS_BODY = {
	success: true,
	result: [
		{ id: 'read-id', name: 'Workers R2 Storage Bucket Item Read' },
		{ id: 'write-id', name: 'Workers R2 Storage Bucket Item Write' },
	],
	errors: [],
}

interface ListedTokenFixture {
	readonly id: string
	readonly name: string
	readonly status: string
}

interface FetchOverrides {
	readonly tokenResult?: { id: string; value: string }
	readonly bucketCreateStatus?: number
	readonly verifyResults?: ReadonlyArray<'ok' | '401'>
	readonly existingTokens?: ReadonlyArray<ListedTokenFixture>
}

interface FetchCall {
	readonly url: string
	readonly method: string
	readonly body: string | undefined
}

interface StubFetchContext {
	readonly fetchMock: ReturnType<typeof vi.fn>
	readonly calls: FetchCall[]
	readonly deletedTokenIds: string[]
}

interface RouterContext {
	readonly url: string
	readonly method: string
	readonly overrides: FetchOverrides
	readonly verifyQueue: Array<'ok' | '401'>
	readonly deletedTokenIds: string[]
}

function routeBucket(ctx: RouterContext): MockResponse | undefined {
	if (/\/r2\/buckets\/[^/]+$/.test(ctx.url) && ctx.method === 'GET') {
		return notFound()
	}
	if (ctx.url.endsWith('/r2/buckets') && ctx.method === 'POST') {
		const status = ctx.overrides.bucketCreateStatus ?? 200
		if (status !== 200) {
			return {
				ok: false,
				status,
				json: () => Promise.resolve({}),
				text: () => Promise.resolve('bucket create boom'),
			}
		}
		return okJson({ success: true, result: { name: 'x' }, errors: [] })
	}
	return undefined
}

function routeTokens(ctx: RouterContext): MockResponse | undefined {
	const byId = /\/user\/tokens\/([^/]+)$/.exec(ctx.url)
	if (byId && ctx.method === 'DELETE') {
		const id = byId[1] ?? ''
		ctx.deletedTokenIds.push(id)
		return okJson({ success: true, result: { id }, errors: [] })
	}
	if (ctx.url.endsWith('/user/tokens')) {
		const tokenResult = ctx.overrides.tokenResult ?? {
			id: 'new-token-id',
			value: 'raw-token-value',
		}
		if (ctx.method === 'POST') {
			return okJson({ success: true, result: tokenResult, errors: [] })
		}
		return okJson({
			success: true,
			result: ctx.overrides.existingTokens ?? [],
			errors: [],
		})
	}
	return undefined
}

function routeS3Verify(ctx: RouterContext): MockResponse | undefined {
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
	const calls: FetchCall[] = []
	const verifyQueue = [...(overrides.verifyResults ?? ['ok'])]
	const deletedTokenIds: string[] = []

	const fetchMock = vi.fn(
		async (
			url: string | URL,
			init?: { method?: string; body?: string },
		): Promise<MockResponse> => {
			const u = String(url)
			calls.push({
				url: u,
				method: init?.method ?? 'GET',
				body: init?.body,
			})
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
				routeBucket(ctx) ?? routeTokens(ctx) ?? routeS3Verify(ctx)
			if (routed) return routed
			throw new Error(`unexpected fetch: ${ctx.method} ${u}`)
		},
	)
	vi.stubGlobal('fetch', fetchMock)
	return { fetchMock, calls, deletedTokenIds }
}

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'infra-ak',
	secretAccessKey: 'infra-sk',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

beforeEach(() => {
	fakeR2State.clear()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('ensureR2Service', () => {
	it('creates one bucket per alias with the per-environment naming scheme', async () => {
		const { calls } = stubFetch()

		await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads', 'media'],
		})

		const bucketProbes = calls
			.filter(
				c => c.method === 'GET' && /\/r2\/buckets\/[^/]+$/.test(c.url),
			)
			.map(c => c.url)
		expect(bucketProbes).toHaveLength(2)
		expect(
			bucketProbes.some(u => u.endsWith('/myapp-production-uploads')),
		).toBe(true)
		expect(
			bucketProbes.some(u => u.endsWith('/myapp-production-media')),
		).toBe(true)
	})

	it('creates buckets in the configured location hint when probe returns 404', async () => {
		const { calls } = stubFetch()

		await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads'],
		})

		const createCall = calls.find(
			c => c.method === 'POST' && c.url.endsWith('/r2/buckets'),
		)
		expect(createCall).toBeDefined()
		const body: unknown = JSON.parse(createCall?.body ?? '{}')
		expect(body).toEqual({
			name: 'myapp-production-uploads',
			locationHint: 'weur',
		})
	})

	it('mints a token named for the project + environment', async () => {
		const { calls } = stubFetch()

		await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'development',
			bucketAliases: ['uploads'],
		})

		const createTokenCall = calls.find(
			c => c.method === 'POST' && c.url.endsWith('/user/tokens'),
		)
		expect(createTokenCall).toBeDefined()
		const body: unknown = JSON.parse(createTokenCall?.body ?? '{}')
		expect(body).toMatchObject({ name: 'nextnode-r2-myapp-development' })
	})

	it('returns S3-compatible state with derived credentials and bucket bindings', async () => {
		stubFetch({
			tokenResult: { id: 'token-key-id', value: 'token-secret' },
		})

		const result = await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads', 'media'],
		})

		expect(result.endpoint).toBe(
			'https://acct-123.r2.cloudflarestorage.com',
		)
		expect(result.accessKeyId).toBe('token-key-id')
		expect(result.secretAccessKey).toHaveLength(64)
		expect(result.buckets).toEqual([
			{ alias: 'uploads', name: 'myapp-production-uploads' },
			{ alias: 'media', name: 'myapp-production-media' },
		])
	})

	it('persists state to the project-scoped state key in the infra state bucket', async () => {
		stubFetch({
			tokenResult: { id: 'token-key-id', value: 'token-secret' },
		})

		const result = await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads'],
		})

		const persisted = fakeR2State.get('services/r2/myapp/production.json')
		expect(persisted).toBeDefined()
		expect(JSON.parse(persisted ?? '{}')).toEqual({
			endpoint: result.endpoint,
			accessKeyId: result.accessKeyId,
			secretAccessKey: result.secretAccessKey,
			buckets: [{ alias: 'uploads', name: 'myapp-production-uploads' }],
		})
	})

	it('polls verification until credentials become active', async () => {
		stubFetch({ verifyResults: ['401', '401', 'ok'] })

		const result = await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads'],
		})

		expect(result.accessKeyId).toBe('new-token-id')
	})

	it('throws when token never propagates within the verification budget', async () => {
		stubFetch({ verifyResults: ['401', '401', '401', '401', '401'] })

		await expect(
			ensureR2Service({
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
				bucketAliases: ['uploads'],
			}),
		).rejects.toThrow(/did not become active after 5 attempts/)
	})

	it('revokes prior tokens sharing the service token name (excluding the new one)', async () => {
		const { deletedTokenIds } = stubFetch({
			existingTokens: [
				{
					id: 'old-1',
					name: 'nextnode-r2-myapp-production',
					status: 'active',
				},
				{
					id: 'old-2',
					name: 'nextnode-r2-myapp-production',
					status: 'active',
				},
				{
					id: 'new-token-id',
					name: 'nextnode-r2-myapp-production',
					status: 'active',
				},
				{ id: 'unrelated', name: 'some-other-token', status: 'active' },
			],
		})

		await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads'],
		})

		expect(deletedTokenIds.toSorted()).toEqual(['old-1', 'old-2'])
	})

	it('propagates bucket-creation failures', async () => {
		stubFetch({ bucketCreateStatus: 500 })

		await expect(
			ensureR2Service({
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
				bucketAliases: ['uploads'],
			}),
		).rejects.toThrow(/500/)
	})

	it('probes verification against the first declared bucket', async () => {
		const { calls } = stubFetch()

		await ensureR2Service({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['first-bucket', 'second-bucket'],
		})

		const verifyCalls = calls.filter(c =>
			c.url.includes('r2.cloudflarestorage.com'),
		)
		expect(verifyCalls).toHaveLength(1)
		expect(verifyCalls[0]?.url).toContain('/myapp-production-first-bucket')
	})
})
