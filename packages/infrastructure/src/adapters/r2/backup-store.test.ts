import { S3Client } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { wipePostgresBackups } from './backup-store.ts'

const send = vi.fn()
const fakeS3 = new S3Client({ region: 'auto' })
fakeS3.send = send

const BUCKET = 'nn-backups-acme'

beforeEach(() => {
	send.mockReset()
})

describe('wipePostgresBackups', () => {
	it('deletes the bucket directly when it is already empty', async () => {
		send.mockImplementation(async command => {
			if (command.constructor.name === 'ListObjectsV2Command') {
				return { Contents: [], NextContinuationToken: undefined }
			}
			return {}
		})

		await wipePostgresBackups(fakeS3, BUCKET)

		const calls = send.mock.calls.map(c => c[0].constructor.name)
		expect(calls).toEqual(['ListObjectsV2Command', 'DeleteBucketCommand'])
	})

	it('lists, batch-deletes, then drops the bucket in a single page', async () => {
		send.mockImplementation(async command => {
			if (command.constructor.name === 'ListObjectsV2Command') {
				return {
					Contents: [
						{ Key: 'postgres/2026-05-19T10-00-00Z.dump' },
						{ Key: 'postgres/2026-05-19T11-00-00Z.dump' },
					],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		await wipePostgresBackups(fakeS3, BUCKET)

		const calls = send.mock.calls.map(c => c[0].constructor.name)
		expect(calls).toEqual([
			'ListObjectsV2Command',
			'DeleteObjectsCommand',
			'DeleteBucketCommand',
		])
		const deleteCall = send.mock.calls.find(
			c => c[0].constructor.name === 'DeleteObjectsCommand',
		)
		expect(deleteCall?.[0].input).toEqual({
			Bucket: BUCKET,
			Delete: {
				Objects: [
					{ Key: 'postgres/2026-05-19T10-00-00Z.dump' },
					{ Key: 'postgres/2026-05-19T11-00-00Z.dump' },
				],
			},
		})
	})

	it('paginates through multiple list pages before dropping the bucket', async () => {
		let listCalls = 0
		send.mockImplementation(async command => {
			if (command.constructor.name === 'ListObjectsV2Command') {
				listCalls += 1
				if (listCalls === 1) {
					return {
						Contents: [{ Key: 'postgres/a.dump' }],
						NextContinuationToken: 'token-2',
					}
				}
				return {
					Contents: [
						{ Key: 'postgres/b.dump' },
						{ Key: 'postgres/c.dump' },
					],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		await wipePostgresBackups(fakeS3, BUCKET)

		const calls = send.mock.calls.map(c => c[0].constructor.name)
		expect(calls).toEqual([
			'ListObjectsV2Command',
			'DeleteObjectsCommand',
			'ListObjectsV2Command',
			'DeleteObjectsCommand',
			'DeleteBucketCommand',
		])
	})

	it('skips entries without a Key', async () => {
		send.mockImplementation(async command => {
			if (command.constructor.name === 'ListObjectsV2Command') {
				return {
					Contents: [{ Key: 'postgres/a.dump' }, { Key: undefined }],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		await wipePostgresBackups(fakeS3, BUCKET)

		const deleteCall = send.mock.calls.find(
			c => c[0].constructor.name === 'DeleteObjectsCommand',
		)
		expect(deleteCall?.[0].input.Delete.Objects).toEqual([
			{ Key: 'postgres/a.dump' },
		])
	})

	it('sends the bucket name on every command', async () => {
		send.mockImplementation(async command => {
			if (command.constructor.name === 'ListObjectsV2Command') {
				return {
					Contents: [{ Key: 'postgres/a.dump' }],
					NextContinuationToken: undefined,
				}
			}
			return {}
		})

		await wipePostgresBackups(fakeS3, BUCKET)

		for (const [command] of send.mock.calls) {
			expect(command.input.Bucket).toBe(BUCKET)
		}
	})
})
