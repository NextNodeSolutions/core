import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { PostgresBackupSnapshot } from '#/domain/services/postgres.ts'
import {
	POSTGRES_BACKUP_PREFIX,
	parsePostgresBackupKey,
} from '#/domain/services/postgres.ts'
import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { S3Client } from '@aws-sdk/client-s3'

/**
 * Enumerate the postgres backup snapshots in `bucket` via paginated
 * ListObjectsV2 under the `postgres/` prefix. Keys that don't match the
 * sidecar's naming pattern are dropped on the floor — selection only
 * ever considers objects we know we wrote, so a stray manual upload
 * cannot displace a real dump.
 *
 * Pagination is sequential because the continuation token is server-
 * issued and each page depends on the previous response.
 */
export async function listPostgresBackupSnapshots(
	s3: S3Client,
	bucket: string,
): Promise<PostgresBackupSnapshot[]> {
	const snapshots: PostgresBackupSnapshot[] = []
	let continuationToken: string | undefined

	/* eslint-disable no-await-in-loop -- pagination is intentionally sequential */
	do {
		const response = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				Prefix: `${POSTGRES_BACKUP_PREFIX}/`,
				ContinuationToken: continuationToken,
			}),
		)
		for (const object of response.Contents ?? []) {
			if (typeof object.Key !== 'string') continue
			const parsed = parsePostgresBackupKey(object.Key)
			if (parsed !== null) snapshots.push(parsed)
		}
		continuationToken = response.NextContinuationToken
	} while (continuationToken !== undefined)
	/* eslint-enable no-await-in-loop */

	return snapshots
}

/**
 * Stream the bytes of `bucket/key` to `destPath`. Used to materialise a
 * backup dump on disk before invoking pg_restore (which only accepts a
 * file path for custom-format archives, not a stdin pipe in the
 * narrow-format case we use).
 *
 * The S3 SDK's `Body` is a union across runtimes (Readable in Node,
 * Blob / ReadableStream in browsers). We narrow with `instanceof
 * Readable` to keep the pipeline type-safe without an `as` cast — this
 * code only ever runs in Node so the non-Readable branch is defensive.
 * Per AWS SDK guidance the body must always be consumed (or cancelled)
 * to free the underlying socket; the guard `cancel`s a ReadableStream
 * before throwing so we never leak a connection on the unreachable
 * branch.
 */
export async function downloadPostgresBackup(
	s3: S3Client,
	bucket: string,
	key: string,
	destPath: string,
): Promise<void> {
	const response = await s3.send(
		new GetObjectCommand({ Bucket: bucket, Key: key }),
	)
	const body = response.Body
	if (!(body instanceof Readable)) {
		if (body !== undefined && 'cancel' in body) {
			await body.cancel()
		}
		throw new Error(
			`R2 download "${bucket}/${key}": expected a Node Readable body`,
		)
	}
	await pipeline(body, createWriteStream(destPath))
}

/**
 * Empty `bucket` (paginated list + batch delete), then delete the bucket
 * itself. Used by teardown's --wipe-backups path: the per-project bucket
 * `nn-backups-<project>` is dedicated to postgres dumps, so wiping it is
 * equivalent to dropping every snapshot. R2 (like S3) refuses
 * DeleteBucket on a non-empty bucket — the empty-then-drop sequence is
 * mandatory, not a courtesy.
 */
export async function wipePostgresBackups(
	s3: S3Client,
	bucket: string,
): Promise<void> {
	let continuationToken: string | undefined

	/* eslint-disable no-await-in-loop -- pagination is intentionally sequential */
	do {
		const listResponse = await s3.send(
			new ListObjectsV2Command({
				Bucket: bucket,
				ContinuationToken: continuationToken,
			}),
		)

		const keysToDelete: Array<{ Key: string }> = []
		for (const object of listResponse.Contents ?? []) {
			if (typeof object.Key === 'string') {
				keysToDelete.push({ Key: object.Key })
			}
		}

		if (keysToDelete.length > 0) {
			await s3.send(
				new DeleteObjectsCommand({
					Bucket: bucket,
					Delete: { Objects: keysToDelete },
				}),
			)
		}

		continuationToken = listResponse.NextContinuationToken
	} while (continuationToken !== undefined)
	/* eslint-enable no-await-in-loop */

	await s3.send(new DeleteBucketCommand({ Bucket: bucket }))
}
