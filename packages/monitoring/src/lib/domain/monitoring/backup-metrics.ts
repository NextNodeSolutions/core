import type { BackupObject } from '@/lib/adapters/r2/backups.ts'

const MS_PER_SECOND = 1000

export interface ProjectBackups {
	readonly project: string
	/** null = no backup bucket (project has no embedded postgres). */
	readonly objects: ReadonlyArray<BackupObject> | null
}

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
 * Render the Prometheus exposition for backup freshness: one
 * `nn_backup_last_success_timestamp_seconds{project="…"}` sample per
 * project that has at least one dump in its backup bucket. This is the
 * metric the BackupStale rule (> 26 h) alerts on - it closes the
 * "backups silently broken" gap the audit flagged. Projects without a
 * bucket emit nothing; projects with an empty bucket emit nothing either
 * (no successful backup yet - the absence is visible in the dashboard,
 * and alerting on never-backed-up projects is a provisioning concern,
 * not a staleness one).
 */
export const renderBackupMetrics = (
	projects: ReadonlyArray<ProjectBackups>,
): string => {
	const lines = [
		'# HELP nn_backup_last_success_timestamp_seconds Unix time of the newest postgres dump in the project backup bucket.',
		'# TYPE nn_backup_last_success_timestamp_seconds gauge',
	]
	for (const entry of projects) {
		if (entry.objects === null) continue
		const epoch = latestEpochSeconds(entry.objects)
		if (epoch === null) continue
		lines.push(
			`nn_backup_last_success_timestamp_seconds{project="${entry.project}"} ${String(epoch)}`,
		)
	}
	return `${lines.join('\n')}\n`
}
