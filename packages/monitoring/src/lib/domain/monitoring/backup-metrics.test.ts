import { describe, expect, it } from 'vitest'

import {
	renderBackupMetrics,
	renderWalgBackupMetrics,
} from './backup-metrics.ts'

describe('renderBackupMetrics', () => {
	it('emits the newest dump timestamp per project as a gauge', () => {
		const out = renderBackupMetrics([
			{
				project: 'stylot',
				objects: [
					{
						key: 'postgres/stylot_2026-06-10T03:00:00.dump',
						lastModified: '2026-06-10T03:00:00.000Z',
					},
					{
						key: 'postgres/stylot_2026-06-12T03:00:00.dump',
						lastModified: '2026-06-12T03:00:00.000Z',
					},
				],
			},
		])

		// 2026-06-12T03:00:00Z = 1781233200 epoch seconds.
		expect(out).toContain(
			'nn_backup_last_success_timestamp_seconds{project="stylot"} 1781233200',
		)
	})

	it('includes the HELP and TYPE header lines', () => {
		const out = renderBackupMetrics([])
		expect(out).toContain('# HELP nn_backup_last_success_timestamp_seconds')
		expect(out).toContain(
			'# TYPE nn_backup_last_success_timestamp_seconds gauge',
		)
	})

	it('skips projects with no backup bucket (objects null)', () => {
		const out = renderBackupMetrics([{ project: 'nodb', objects: null }])
		expect(out).not.toContain('project="nodb"')
	})

	it('skips projects whose bucket exists but is empty', () => {
		const out = renderBackupMetrics([{ project: 'fresh', objects: [] }])
		expect(out).not.toContain('project="fresh"')
	})

	it('ignores objects with an unparseable lastModified', () => {
		const out = renderBackupMetrics([
			{
				project: 'broken',
				objects: [{ key: 'postgres/x.dump', lastModified: 'nonsense' }],
			},
		])
		expect(out).not.toContain('project="broken"')
	})
})

describe('renderWalgBackupMetrics', () => {
	it('emits the newest base-backup timestamp per project as a gauge', () => {
		const out = renderWalgBackupMetrics([
			{
				project: 'stylot',
				objects: [
					{
						key: 'basebackups_005/base_000000010000000000000010_backup_stop_sentinel.json',
						lastModified: '2026-06-10T03:00:00.000Z',
					},
					{
						key: 'basebackups_005/base_000000010000000000000012_backup_stop_sentinel.json',
						lastModified: '2026-06-12T03:00:00.000Z',
					},
				],
			},
		])

		// 2026-06-12T03:00:00Z = 1781233200 epoch seconds.
		expect(out).toContain(
			'nn_walg_base_backup_last_success_timestamp_seconds{project="stylot"} 1781233200',
		)
	})

	it('includes the HELP and TYPE header lines', () => {
		const out = renderWalgBackupMetrics([])
		expect(out).toContain(
			'# HELP nn_walg_base_backup_last_success_timestamp_seconds',
		)
		expect(out).toContain(
			'# TYPE nn_walg_base_backup_last_success_timestamp_seconds gauge',
		)
	})

	it('does not emit the pg_dump metric name (the two families are distinct)', () => {
		const out = renderWalgBackupMetrics([
			{
				project: 'stylot',
				objects: [
					{
						key: 'basebackups_005/base_x_backup_stop_sentinel.json',
						lastModified: '2026-06-12T03:00:00.000Z',
					},
				],
			},
		])
		expect(out).not.toContain('nn_backup_last_success_timestamp_seconds')
	})

	it('skips projects with no wal-g bucket (objects null)', () => {
		const out = renderWalgBackupMetrics([
			{ project: 'nowalg', objects: null },
		])
		expect(out).not.toContain('project="nowalg"')
	})

	it('skips projects whose wal-g bucket exists but is empty', () => {
		const out = renderWalgBackupMetrics([{ project: 'fresh', objects: [] }])
		expect(out).not.toContain('project="fresh"')
	})
})
