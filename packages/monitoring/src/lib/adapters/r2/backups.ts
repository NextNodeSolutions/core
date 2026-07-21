import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { R2StateApiFailure } from '@/lib/adapters/r2/state.ts'
import { signSigV4Request } from '@/lib/domain/aws/sigv4.ts'

import type { R2StateClient } from '@/lib/adapters/r2/state.ts'

const HTTP_NOT_FOUND = 404

/** pg_dump logical backups live under this prefix in `<project>-backups-dump`. */
const PG_DUMP_PREFIX = 'postgres/'
/** wal-g physical base backups live under this prefix in `<project>-backups`. */
const WALG_BASE_BACKUP_PREFIX = 'basebackups_005/'

export interface BackupObject {
	readonly key: string
	readonly lastModified: string
}

const KEY_ENTRY_PATTERN =
	/<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<\/Contents>/g

const parseListXml = (xml: string): ReadonlyArray<BackupObject> => {
	const objects: Array<BackupObject> = []
	for (const match of xml.matchAll(KEY_ENTRY_PATTERN)) {
		const [, key, lastModified] = match
		if (typeof key !== 'undefined' && typeof lastModified !== 'undefined') {
			objects.push({ key, lastModified })
		}
	}
	return objects
}

// Bucket names MUST match the infrastructure package's source of truth
// (`postgresBackupBucketName` / `postgresWalgBucketName` in
// `packages/infrastructure/src/domain/services/postgres{,-walg}.ts`), which the
// deploy pipeline uses to create + write these buckets. They were renamed
// (commit 0d8a3ec) from the old `nn-walg-<p>` / `nn-backups-<p>` scheme; keep
// these two derivations in lockstep or backup-health silently reads empty.
export const pgDumpBucketName = (project: string): string =>
	`${project}-backups-dump`
export const walgBucketName = (project: string): string => `${project}-backups`

const fetchBucketObjects = async (args: {
	client: R2StateClient
	bucket: string
	prefix: string
}): Promise<ReadonlyArray<BackupObject> | null> => {
	const host = `${args.client.accountId}.r2.cloudflarestorage.com`
	const path = `/${args.bucket}`
	const query = `list-type=2&prefix=${encodeURIComponent(args.prefix)}`
	const signed = signSigV4Request({
		accessKeyId: args.client.accessKeyId,
		secretAccessKey: args.client.secretAccessKey,
		method: 'GET',
		host,
		path,
		query,
		region: 'auto',
		service: 's3',
		payload: '',
		now: new Date(),
	})

	const response = await fetch(signed.url, { headers: signed.headers })
	// No such bucket = the project has no embedded postgres (for the dump
	// bucket) or no wal-g archiving (for the walg bucket) - an answer, not an
	// error. A bucket-scoped token also returns 404 for an out-of-scope bucket.
	if (response.status === HTTP_NOT_FOUND) return null
	if (!response.ok) {
		throw new R2StateApiFailure(
			`r2-backups list ${args.bucket}`,
			response.status,
			await response.text(),
		)
	}
	return parseListXml(await response.text())
}

// The freshness alerts fire after hours of silence; one listing per 5 min
// per bucket keeps the signal fresh at negligible R2 cost.
const BACKUPS_TTL_MS = 300_000

const memoizedFetchBucketObjects = keyedMemoizeAsync(
	BACKUPS_TTL_MS,
	(args: { client: R2StateClient; bucket: string; prefix: string }) =>
		`${args.client.accountId} ${args.bucket} ${args.prefix}`,
	fetchBucketObjects,
)

/**
 * List the pg_dump objects of a project's logical-backup bucket; null when the
 * bucket does not exist (no embedded postgres).
 */
export const listBackupObjects = (
	client: R2StateClient,
	project: string,
): Promise<ReadonlyArray<BackupObject> | null> =>
	memoizedFetchBucketObjects({
		client,
		bucket: pgDumpBucketName(project),
		prefix: PG_DUMP_PREFIX,
	})

/**
 * List the wal-g base-backup objects of a project's wal-g bucket; null when the
 * bucket does not exist (no wal-g archiving, e.g. a non-production project).
 * The newest object's timestamp is the last successful `wal-g backup-push`.
 */
export const listWalgBaseBackupObjects = (
	client: R2StateClient,
	project: string,
): Promise<ReadonlyArray<BackupObject> | null> =>
	memoizedFetchBucketObjects({
		client,
		bucket: walgBucketName(project),
		prefix: WALG_BASE_BACKUP_PREFIX,
	})
