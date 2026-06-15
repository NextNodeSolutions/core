import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * The per-project backup R2 token the infra persists at provision time
 * (`services/postgres-backup/<project>/<environment>.json` in the state
 * bucket). It is scoped to the project's backup buckets (`<project>-backups`
 * wal-g + `<project>-backups-dump` pg_dump), which the infra STATE token is
 * NOT - so backup-freshness listing must use these creds, not the state token.
 * The persisted object also carries `endpoint`, redundant with the account id
 * already known to the reader, so only the keys are parsed.
 */
export interface PostgresBackupCreds {
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

export const parsePostgresBackupCreds = (
	payload: unknown,
): PostgresBackupCreds | null => {
	if (!isRecord(payload)) return null
	const { accessKeyId, secretAccessKey } = payload
	if (typeof accessKeyId !== 'string' || accessKeyId === '') return null
	if (typeof secretAccessKey !== 'string' || secretAccessKey === '') {
		return null
	}
	return { accessKeyId, secretAccessKey }
}
