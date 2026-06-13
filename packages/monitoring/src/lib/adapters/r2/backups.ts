import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { R2StateApiFailure } from '@/lib/adapters/r2/state.ts'
import { signSigV4Request } from '@/lib/domain/aws/sigv4.ts'

import type { R2StateClient } from '@/lib/adapters/r2/state.ts'

const HTTP_NOT_FOUND = 404
const BACKUP_PREFIX = 'postgres/'

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
		if (key !== undefined && lastModified !== undefined) {
			objects.push({ key, lastModified })
		}
	}
	return objects
}

const backupBucketName = (project: string): string => `nn-backups-${project}`

const fetchBackupObjects = async (args: {
	client: R2StateClient
	project: string
}): Promise<ReadonlyArray<BackupObject> | null> => {
	const host = `${args.client.accountId}.r2.cloudflarestorage.com`
	const path = `/${backupBucketName(args.project)}`
	const query = `list-type=2&prefix=${encodeURIComponent(BACKUP_PREFIX)}`
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
	// No backup bucket = the project has no embedded postgres - an
	// answer, not an error.
	if (response.status === HTTP_NOT_FOUND) return null
	if (!response.ok) {
		throw new R2StateApiFailure(
			`r2-backups list ${backupBucketName(args.project)}`,
			response.status,
			await response.text(),
		)
	}
	return parseListXml(await response.text())
}

// The freshness alert fires after 26h of silence; one listing per 5 min
// per project keeps the signal fresh at negligible R2 cost.
const BACKUPS_TTL_MS = 300_000

const memoizedListBackupObjects = keyedMemoizeAsync(
	BACKUPS_TTL_MS,
	(args: { client: R2StateClient; project: string }) =>
		`${args.client.accountId} ${args.project}`,
	fetchBackupObjects,
)

/**
 * List the postgres dump objects of a project's backup bucket; null when
 * the bucket does not exist (no embedded postgres).
 */
export const listBackupObjects = (
	client: R2StateClient,
	project: string,
): Promise<ReadonlyArray<BackupObject> | null> =>
	memoizedListBackupObjects({ client, project })
