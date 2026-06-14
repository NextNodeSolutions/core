import { describe, expect, it } from 'vitest'

import { pgDumpBucketName, walgBucketName } from '@/lib/adapters/r2/backups.ts'

// These names are the contract with the infrastructure package, which creates
// and writes the buckets at deploy time (`postgresWalgBucketName` /
// `postgresBackupBucketName`). If infra renames again, these must follow or the
// backup-health panel reads a non-existent bucket and reports "no backups".
describe('backup bucket names match the infrastructure convention', () => {
	it('derives the wal-g bucket as <project>-backups', () => {
		expect(walgBucketName('stylot')).toBe('stylot-backups')
	})

	it('derives the pg_dump bucket as <project>-backups-dump', () => {
		expect(pgDumpBucketName('stylot')).toBe('stylot-backups-dump')
	})
})
