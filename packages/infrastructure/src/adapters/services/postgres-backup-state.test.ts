import { describe, expect, it, vi } from 'vitest'

import {
	readPostgresBackupState,
	writePostgresBackupState,
} from './postgres-backup-state.ts'

import type {
	ObjectStoreClient,
	ObjectStoreEntry,
} from '#/domain/storage/object-store.ts'

function fakeStore(stored: ObjectStoreEntry | null): ObjectStoreClient {
	return {
		get: vi.fn().mockResolvedValue(stored),
		put: vi.fn().mockResolvedValue('etag'),
		delete: vi.fn().mockResolvedValue(undefined),
		exists: vi.fn().mockResolvedValue(false),
		deleteByPrefix: vi.fn().mockResolvedValue(0),
	}
}

function entry(body: string): ObjectStoreEntry {
	return { body, etag: 'etag' }
}

const VALID = {
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'key',
	secretAccessKey: 'secret',
}

describe('readPostgresBackupState', () => {
	it('returns null when the object is absent', async () => {
		expect(await readPostgresBackupState(fakeStore(null), 'k')).toBeNull()
	})

	it('parses a valid persisted state', async () => {
		const state = await readPostgresBackupState(
			fakeStore(entry(JSON.stringify(VALID))),
			'k',
		)
		expect(state).toEqual(VALID)
	})

	it('throws when the stored payload is not an object', async () => {
		await expect(
			readPostgresBackupState(fakeStore(entry('"a string"')), 'k'),
		).rejects.toThrow(/not an object/)
	})

	it('throws when endpoint is missing', async () => {
		await expect(
			readPostgresBackupState(
				fakeStore(
					entry(
						JSON.stringify({
							accessKeyId: 'key',
							secretAccessKey: 'secret',
						}),
					),
				),
				'k',
			),
		).rejects.toThrow(/missing endpoint/)
	})

	it('throws when accessKeyId is missing', async () => {
		await expect(
			readPostgresBackupState(
				fakeStore(
					entry(
						JSON.stringify({
							endpoint: VALID.endpoint,
							secretAccessKey: 'secret',
						}),
					),
				),
				'k',
			),
		).rejects.toThrow(/missing accessKeyId/)
	})

	it('throws when secretAccessKey is missing', async () => {
		await expect(
			readPostgresBackupState(
				fakeStore(
					entry(
						JSON.stringify({
							endpoint: VALID.endpoint,
							accessKeyId: 'key',
						}),
					),
				),
				'k',
			),
		).rejects.toThrow(/missing secretAccessKey/)
	})
})

describe('writePostgresBackupState', () => {
	it('serializes the state to JSON under the given key', async () => {
		const store = fakeStore(null)

		await writePostgresBackupState(
			store,
			'services/postgres-backup/x.json',
			VALID,
		)

		expect(store.put).toHaveBeenCalledWith(
			'services/postgres-backup/x.json',
			JSON.stringify(VALID),
		)
	})
})
