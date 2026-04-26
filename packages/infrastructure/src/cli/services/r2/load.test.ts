import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { R2ServiceState } from '#/domain/services/r2.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { okEmpty, unauthorized } from '#/test-fetch.ts'

import { loadR2Service } from './load.ts'

interface StubOptions {
	readonly verifyStatus?: 'ok' | '401'
}

interface StubContext {
	readonly fetchMock: ReturnType<typeof vi.fn>
	readonly urls: string[]
}

function stubFetch(options: StubOptions = {}): StubContext {
	const verifyStatus = options.verifyStatus ?? 'ok'
	const urls: string[] = []

	const fetchMock = vi.fn(
		async (input: string | URL): Promise<MockResponse> => {
			const url = String(input)
			urls.push(url)
			if (url.includes('r2.cloudflarestorage.com')) {
				return verifyStatus === 'ok' ? okEmpty() : unauthorized()
			}
			throw new Error(`unexpected fetch: ${url}`)
		},
	)
	vi.stubGlobal('fetch', fetchMock)
	return { fetchMock, urls }
}

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'infra-ak',
	secretAccessKey: 'infra-sk',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

const STATE: R2ServiceState = {
	endpoint: 'https://acct-123.r2.cloudflarestorage.com',
	accessKeyId: 'svc-ak',
	secretAccessKey: 'svc-sk',
	buckets: [
		{ alias: 'uploads', name: 'myapp-production-uploads' },
		{ alias: 'media', name: 'myapp-production-media' },
	],
}

const STATE_KEY = 'services/r2/myapp/production.json'

function seedState(state: R2ServiceState): void {
	fakeR2State.set(STATE_KEY, JSON.stringify(state))
}

beforeEach(() => {
	fakeR2State.clear()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

describe('loadR2Service', () => {
	it('returns the persisted state when credentials verify', async () => {
		seedState(STATE)
		stubFetch({ verifyStatus: 'ok' })

		const result = await loadR2Service({
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
		})

		expect(result).toEqual(STATE)
	})

	it('throws when no state has been written for the project + environment', async () => {
		stubFetch()

		await expect(
			loadR2Service({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			}),
		).rejects.toThrow(
			/R2 service state not found at "services\/r2\/myapp\/production\.json".*run provision/,
		)
	})

	it('throws when stored state has zero buckets (corrupt state)', async () => {
		seedState({ ...STATE, buckets: [] })
		stubFetch()

		await expect(
			loadR2Service({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			}),
		).rejects.toThrow(/has no buckets.*re-run provision/)
	})

	it('throws — does not rotate — when persisted credentials are stale', async () => {
		seedState(STATE)
		stubFetch({ verifyStatus: '401' })

		await expect(
			loadR2Service({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			}),
		).rejects.toThrow(/stale.*Re-run provision to rotate/)
	})

	it('verifies credentials against the first declared bucket', async () => {
		seedState(STATE)
		const { urls } = stubFetch({ verifyStatus: 'ok' })

		await loadR2Service({
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
		})

		const verifyCalls = urls.filter(u =>
			u.includes('r2.cloudflarestorage.com'),
		)
		expect(verifyCalls).toHaveLength(1)
		expect(verifyCalls[0]).toContain('/myapp-production-uploads')
	})

	it('reads state from the project + environment scoped key', async () => {
		fakeR2State.set(
			'services/r2/other/production.json',
			JSON.stringify(STATE),
		)
		seedState({
			...STATE,
			accessKeyId: 'correct-ak',
			secretAccessKey: 'correct-sk',
		})
		stubFetch({ verifyStatus: 'ok' })

		const result = await loadR2Service({
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
		})

		expect(result.accessKeyId).toBe('correct-ak')
		expect(result.secretAccessKey).toBe('correct-sk')
	})
})
