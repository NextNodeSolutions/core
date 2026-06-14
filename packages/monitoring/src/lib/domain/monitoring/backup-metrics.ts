import type { BackupObject } from '@/lib/adapters/r2/backups.ts'

const MS_PER_SECOND = 1000

export interface ProjectBackups {
	readonly project: string
	/** null = no backup bucket (project has no embedded postgres / no wal-g). */
	readonly objects: ReadonlyArray<BackupObject> | null
}

/**
 * Escape a string for use as a Prometheus exposition label value: the format
 * requires backslash, double-quote and line feed to be backslash-escaped (in
 * that order, backslash first). Project names are normally inert, but escaping
 * keeps a stray character from breaking the line the scraper parses.
 */
const escapeLabelValue = (labelValue: string): string =>
	labelValue
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"')
		.replaceAll('\n', '\\n')

const latestEpochSeconds = (
	objects: ReadonlyArray<BackupObject>,
): number | null => {
	let latest: number | null = null
	for (const object of objects) {
		const ms = Date.parse(object.lastModified)
		if (Number.isNaN(ms)) continue
		if (latest === null || ms > latest) latest = ms
	}
	return latest === null ? null : Math.floor(latest / MS_PER_SECOND)
}

/**
 * Render one `<metric>{project="…"} <epoch>` gauge line per project that has at
 * least one object in its bucket: the newest object's Unix timestamp. Projects
 * without a bucket (`objects === null`) emit nothing; projects with an empty
 * bucket emit nothing either (no successful backup yet - the absence is visible
 * in the dashboard, and alerting on never-backed-up projects is a provisioning
 * concern, not a staleness one). Shared by the pg_dump and wal-g exporters so
 * both freshness metrics stay byte-for-byte consistent.
 */
const renderFreshnessGauge = (
	metric: string,
	help: string,
	projects: ReadonlyArray<ProjectBackups>,
): string => {
	const lines = [`# HELP ${metric} ${help}`, `# TYPE ${metric} gauge`]
	for (const entry of projects) {
		if (entry.objects === null) continue
		const epoch = latestEpochSeconds(entry.objects)
		if (epoch === null) continue
		lines.push(
			`${metric}{project="${escapeLabelValue(entry.project)}"} ${String(epoch)}`,
		)
	}
	return `${lines.join('\n')}\n`
}

/**
 * Prometheus exposition of pg_dump (logical) backup freshness: the
 * `nn_backup_last_success_timestamp_seconds` gauge the BackupStale rule alerts
 * on - it closes the "backups silently broken" gap the audit flagged.
 */
export const renderBackupMetrics = (
	projects: ReadonlyArray<ProjectBackups>,
): string =>
	renderFreshnessGauge(
		'nn_backup_last_success_timestamp_seconds',
		'Unix time of the newest postgres dump in the project backup bucket.',
		projects,
	)

/**
 * Prometheus exposition of wal-g (physical) base-backup freshness: the
 * `nn_walg_base_backup_last_success_timestamp_seconds` gauge the
 * WalgBaseBackupStale (warning) and WalgBaseBackupMissing (critical) rules
 * alert on. The newest object under `basebackups_005/` is the last successful
 * `wal-g backup-push`; a stale value means PITR's base anchor is ageing.
 */
export const renderWalgBackupMetrics = (
	projects: ReadonlyArray<ProjectBackups>,
): string =>
	renderFreshnessGauge(
		'nn_walg_base_backup_last_success_timestamp_seconds',
		'Unix time of the newest wal-g base backup in the project wal-g bucket.',
		projects,
	)
