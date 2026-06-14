/**
 * Outcome of pruning one project's pg_dump backup bucket under the GFS policy.
 * `bucketMissing` marks a project enumerated from the fleet state that has no
 * `<project>-backups-dump` bucket (a non-postgres app, or one never
 * provisioned) - scanned/pruned are then 0 and the row renders as "-".
 */
export interface ProjectPruneOutcome {
	readonly project: string
	readonly scanned: number
	readonly pruned: number
	readonly bucketMissing: boolean
}

/**
 * Render the GH step summary for a `prune-backups` cron run: a header totalling
 * the dumps pruned across all considered projects, then one table row per
 * project (scanned + pruned, or "-" when the project has no pg_dump bucket).
 *
 * Pure: takes the per-project outcomes, returns markdown. The IO (listing the
 * fleet, pruning each bucket) lives in the cli/adapter layers.
 */
export function buildPruneBackupsSummary(
	outcomes: ReadonlyArray<ProjectPruneOutcome>,
): string {
	const totalPruned = outcomes.reduce((sum, o) => sum + o.pruned, 0)
	const header = `## Prune postgres backups\n\nPruned ${String(totalPruned)} dump(s) across ${String(outcomes.length)} project(s).`
	if (outcomes.length === 0) return header

	const rows = outcomes
		.map(o =>
			o.bucketMissing
				? `| ${o.project} | - | - |`
				: `| ${o.project} | ${String(o.scanned)} | ${String(o.pruned)} |`,
		)
		.join('\n')

	return `${header}\n\n| Project | Scanned | Pruned |\n|---|---|---|\n${rows}`
}
