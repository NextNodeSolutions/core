import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { S3Client } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	downloadPostgresBackup,
	listPostgresBackupSnapshots,
	wipePostgresBackups,
} from './backup-store.ts'

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

describe('listPostgresBackupSnapshots', () => {
	it('scopes the listing to the postgres/ prefix', async () => {
		send.mockResolvedValue({ Contents: [], NextContinuationToken: undefined })

		await listPostgresBackupSnapshots(fakeS3, BUCKET)

		expect(send.mock.calls[0]?.[0].input).toMatchObject({
			Bucket: BUCKET,
			Prefix: 'postgres/',
		})
	})

	it('walks every page and drops keys that are not sidecar dumps', async () => {
		let listCalls = 0
		send.mockImplementation(async () => {
			listCalls += 1
			if (listCalls === 1) {
				return {
					Contents: [
						{ Key: 'postgres/acme_2026-05-19T10:00:00.dump' },
						// foreign upload under the prefix - must be dropped so it
						// can never displace a real dump during selection.
						{ Key: 'postgres/not-a-backup.txt' },
					],
					NextContinuationToken: 'page-2',
				}
			}
			return {
				Contents: [{ Key: 'postgres/acme_2026-05-19T11:00:00.dump' }],
				NextContinuationToken: undefined,
			}
		})

		const snapshots = await listPostgresBackupSnapshots(fakeS3, BUCKET)

		// Two list pages were consumed (proves the continuation loop)...
		expect(listCalls).toBe(2)
		expect(send.mock.calls[1]?.[0].input.ContinuationToken).toBe('page-2')
		// ...and only the two well-formed keys survived the filter.
		expect(snapshots.map(snapshot => snapshot.key)).toEqual([
			'postgres/acme_2026-05-19T10:00:00.dump',
			'postgres/acme_2026-05-19T11:00:00.dump',
		])
	})
})

describe('downloadPostgresBackup', () => {
	it('streams a Node Readable body to the destination path', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'backup-store-'))
		const destPath = join(dir, 'dump.bin')
		send.mockResolvedValue({ Body: Readable.from('PGDUMP-bytes') })

		try {
			await downloadPostgresBackup(fakeS3, BUCKET, 'postgres/x.dump', destPath)
			expect(await readFile(destPath, 'utf8')).toBe('PGDUMP-bytes')
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	it('cancels a non-Readable stream body and throws rather than leaking it', async () => {
		const cancel = vi.fn(async () => {})
		send.mockResolvedValue({ Body: { cancel } })

		await expect(
			downloadPostgresBackup(fakeS3, BUCKET, 'postgres/x.dump', '/dev/null'),
		).rejects.toThrow('expected a Node Readable body')
		expect(cancel).toHaveBeenCalledOnce()
	})

	it('throws when the body is absent', async () => {
		send.mockResolvedValue({ Body: undefined })

		await expect(
			downloadPostgresBackup(fakeS3, BUCKET, 'postgres/x.dump', '/dev/null'),
		).rejects.toThrow('expected a Node Readable body')
	})
})
