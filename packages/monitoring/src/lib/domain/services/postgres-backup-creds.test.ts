import { describe, expect, it } from 'vitest'

import { parsePostgresBackupCreds } from './postgres-backup-creds.ts'

describe('parsePostgresBackupCreds', () => {
	it('extracts the access keys from a persisted creds object', () => {
		expect(
			parsePostgresBackupCreds({
				endpoint: 'https://acct.r2.cloudflarestorage.com',
				accessKeyId: 'bk-key',
				secretAccessKey: 'bk-secret',
			}),
		).toEqual({ accessKeyId: 'bk-key', secretAccessKey: 'bk-secret' })
	})

	it('returns null for non-objects and missing/empty keys', () => {
		expect(parsePostgresBackupCreds(null)).toBeNull()
		expect(parsePostgresBackupCreds('nope')).toBeNull()
		expect(parsePostgresBackupCreds({ accessKeyId: 'k' })).toBeNull()
		expect(
			parsePostgresBackupCreds({ accessKeyId: '', secretAccessKey: 's' }),
		).toBeNull()
	})
})
