import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
	POSTGRES_BACKUP_PREFIX,
	parsePostgresBackupKey,
	selectPostgresBackupsToPrune,
} from '#/domain/services/postgres.ts'
import {
	DeleteBucketCommand,
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3'

import type { PostgresBackupSnapshot } from '#/domain/services/postgres.ts'
import type { S3Client, _Object } from '@aws-sdk/client-s3'

// S3/R2 cap a single DeleteObjects request at 1000 keys; larger prune/wipe sets
// are split into successive batches.
const DELETE_BATCH_SIZE = 1000

// Parse the sidecar-named backup keys out of one ListObjectsV2 page, dropping
// objects we did not write (keys that fail the naming pattern).
function collectBackupSnapshots(
	objects: ReadonlyArray<_Object>,
): ReadonlyArray<PostgresBackupSnapshot> {
	const snapshots: PostgresBackupSnapshot[] = []
	for (const object of objects) {
		const parsed =
			typeof object.Key === 'string'
				? parsePostgresBackupKey(object.Key)
				: null
		if (parsed !== null) snapshots.push(parsed)
	}
	return snapshots
}

// Extract the present string keys from one ListObjectsV2 page.
function keysOf(objects: ReadonlyArray<_Object>): string[] {
	return objects
		.map(object => object.Key)
		.filter((key): key is string => typeof key === 'string')
}

// Delete `keys` in batches of DELETE_BATCH_SIZE. A single batch (the common
// case: one ListObjectsV2 page <= 1000, or a GFS prune set far smaller) sends
// exactly one DeleteObjectsCommand; an empty list sends none. Batches run
// sequentially to stay polite to R2 under large wipes. Shared by the prune and
// wipe paths so the chunking lives in one place.
async function deleteObjectsChunked(
	s3: S3Client,
	bucket: string,
	keys: ReadonlyArray<string>,
): Promise<void> {
	/* eslint-disable no-await-in-loop -- batch deletes are intentionally sequential */
	for (let offset = 0; offset < keys.length; offset += DELETE_BATCH_SIZE) {
		const objects = keys
			.slice(offset, offset + DELETE_BATCH_SIZE)
			.map(key => ({ Key: key }))
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: bucket,
				Delete: { Objects: objects },
			}),
		)
	}
	/* eslint-enable no-await-in-loop */
}

/**
 * Enumerate the postgres backup snapshots in `bucket` via paginated
 * ListObjectsV2 under the `postgres/` prefix. Keys that don't match the
 * sidecar's naming pattern are dropped on the floor - selection only
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
		snapshots.push(...collectBackupSnapshots(response.Contents ?? []))
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
 * Readable` to keep the pipeline type-safe without an `as` cast - this
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
 * itself. Used by teardown's --wipe-backups path on BOTH per-project backup
 * buckets (`<project>-backups` wal-g + `<project>-backups-dump` pg_dump), each
 * dedicated to its scheme, so wiping is equivalent to dropping every snapshot.
 * R2 (like S3) refuses
 * DeleteBucket on a non-empty bucket - the empty-then-drop sequence is
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

		await deleteObjectsChunked(
			s3,
			bucket,
			keysOf(listResponse.Contents ?? []),
		)

		continuationToken = listResponse.NextContinuationToken
	} while (continuationToken !== undefined)
	/* eslint-enable no-await-in-loop */

	await s3.send(new DeleteBucketCommand({ Bucket: bucket }))
}

export interface PrunePostgresBackupsResult {
	// Total sidecar dumps seen under the prefix (foreign keys excluded).
	readonly scanned: number
	// Dumps deleted because they fell outside the GFS retention windows.
	readonly pruned: number
}

/**
 * Apply the GFS retention policy to a project's pg_dump backup bucket: list the
 * dumps, ask the pure `selectPostgresBackupsToPrune` which fall outside the 7
 * daily / 4 weekly / 3 monthly windows, and batch-delete them. The bucket and
 * its kept dumps remain (unlike `wipePostgresBackups`, which drops everything).
 *
 * Keys that don't match the sidecar naming pattern are never listed as
 * snapshots (see `listPostgresBackupSnapshots`), so a stray manual upload is
 * neither classified nor deleted. The image-side age prune is OFF
 * (`POSTGRES_BACKUP_KEEP_DAYS` empty), so this is the SOLE owner of pg_dump
 * retention; wal-g manages its own bucket independently.
 */
export async function prunePostgresBackups(
	s3: S3Client,
	bucket: string,
): Promise<PrunePostgresBackupsResult> {
	const snapshots = await listPostgresBackupSnapshots(s3, bucket)
	const toPrune = selectPostgresBackupsToPrune(snapshots)
	await deleteObjectsChunked(
		s3,
		bucket,
		toPrune.map(snapshot => snapshot.key),
	)
	return { scanned: snapshots.length, pruned: toPrune.length }
}
