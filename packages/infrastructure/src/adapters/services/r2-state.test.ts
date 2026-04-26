import { describe, expect, it, vi } from 'vitest'

import type { R2ServiceState } from '@/domain/services/r2.ts'
import type { ObjectStoreClient } from '@/domain/storage/object-store.ts'

import { readR2ServiceState, writeR2ServiceState } from './r2-state.ts'

const KEY = 'services/r2/myapp/production.json'

const STATE: R2ServiceState = {
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'access-key',
	secretAccessKey: 'secret-key',
	buckets: [{ alias: 'uploads', name: 'myapp-production-uploads' }],
}

function fakeR2(state: Map<string, string>): ObjectStoreClient {
	return {
		get: vi.fn(async (key: string) => {
			const body = state.get(key)
			return body === undefined ? null : { body, etag: 'etag' }
		}),
		put: vi.fn(async (key: string, body: string) => {
			state.set(key, body)
			return 'etag'
		}),
		delete: vi.fn(),
		exists: vi.fn(),
		deleteByPrefix: vi.fn(),
	}
}

describe('writeR2ServiceState + readR2ServiceState', () => {
	it('roundtrips the state payload through R2', async () => {
		const state = new Map<string, string>()
		const r2 = fakeR2(state)

		await writeR2ServiceState(r2, KEY, STATE)
		const loaded = await readR2ServiceState(r2, KEY)

		expect(loaded).toEqual(STATE)
	})

	it('returns null when no state has been written', async () => {
		const r2 = fakeR2(new Map())
		expect(await readR2ServiceState(r2, KEY)).toBeNull()
	})

	it('rejects state without an endpoint', async () => {
		const state = new Map<string, string>([
			[
				KEY,
				JSON.stringify({
					accessKeyId: 'k',
					secretAccessKey: 's',
					buckets: [{ alias: 'u', name: 'b' }],
				}),
			],
		])
		await expect(readR2ServiceState(fakeR2(state), KEY)).rejects.toThrow(
			'missing endpoint',
		)
	})

	it('rejects state with malformed bucket bindings', async () => {
		const state = new Map<string, string>([
			[
				KEY,
				JSON.stringify({
					endpoint: 'e',
					accessKeyId: 'k',
					secretAccessKey: 's',
					buckets: [{ alias: 'u' }],
				}),
			],
		])
		await expect(readR2ServiceState(fakeR2(state), KEY)).rejects.toThrow(
			'name missing',
		)
	})
})
