import { describe, expect, it } from 'vitest'

import {
	buildPostgresBackupCredsEnv,
	parsePostgresBackupStateKey,
	postgresBackupStateKey,
	postgresBackupTokenName,
} from './postgres-backup.ts'

describe('postgresBackupTokenName', () => {
	it('is project- and env-scoped and distinct from the r2/infra token names', () => {
		expect(postgresBackupTokenName('acme-web', 'production')).toBe(
			'nextnode-postgres-backup-acme-web-production',
		)
		expect(postgresBackupTokenName('acme-web', 'development')).toBe(
			'nextnode-postgres-backup-acme-web-development',
		)
	})
})

describe('postgresBackupStateKey', () => {
	it('namespaces the persisted creds under services/postgres-backup', () => {
		expect(postgresBackupStateKey('acme-web', 'production')).toBe(
			'services/postgres-backup/acme-web/production.json',
		)
	})
})

describe('parsePostgresBackupStateKey', () => {
	it('round-trips a key produced by postgresBackupStateKey', () => {
		expect(
			parsePostgresBackupStateKey(
				postgresBackupStateKey('acme-web', 'production'),
			),
		).toEqual({ projectName: 'acme-web', environment: 'production' })
	})

	it('rejects keys outside the prefix, malformed keys, and unknown environments', () => {
		expect(parsePostgresBackupStateKey('hetzner/nn-prod.json')).toBeNull()
		expect(
			parsePostgresBackupStateKey('services/postgres-backup/stray.txt'),
		).toBeNull()
		expect(
			parsePostgresBackupStateKey(
				'services/postgres-backup/acme-web/staging.json',
			),
		).toBeNull()
	})
})

describe('buildPostgresBackupCredsEnv', () => {
	it('projects the three backup R2 vars on the secret channel under POSTGRES_BACKUP_R2_*', () => {
		expect(
			buildPostgresBackupCredsEnv({
				endpoint: 'https://acct.r2.cloudflarestorage.com',
				accessKeyId: 'key',
				secretAccessKey: 'secret',
			}),
		).toEqual({
			public: {},
			secret: {
				POSTGRES_BACKUP_R2_ACCESS_KEY_ID: 'key',
				POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY: 'secret',
				POSTGRES_BACKUP_R2_ENDPOINT:
					'https://acct.r2.cloudflarestorage.com',
			},
		})
	})
})
