import type { AppEnvironment } from '#/domain/environment.ts'

import type { SummaryRow } from './summary-renderer.ts'
import { formatDuration, renderKeyValueTable } from './summary-renderer.ts'

export interface MigrateSummaryInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly migrateDurationMs: number
	readonly snapshotDurationMs: number | null
}

/**
 * Render the GH step summary for a `migrate-remote` run. Always lists the
 * project + environment + migrate duration; adds a snapshot duration row
 * when a pre-migrate snapshot ran (embedded mode). Operators don't need
 * the dump's R2 key in the summary — `infrastructure restore --at
 * <deploy-time>` picks the right snapshot by timestamp ordering.
 *
 * `snapshotDurationMs = null` covers `[services.postgres].mode = "external"`
 * and the "no postgres" branch (which short-circuits before this is called).
 */
export function buildMigrateSummary(input: MigrateSummaryInput): string {
	const rows: Array<SummaryRow> = [
		['**Project**', input.projectName],
		['**Environment**', input.environment],
	]

	if (input.snapshotDurationMs !== null) {
		rows.push([
			'**Pre-migrate snapshot**',
			formatDuration(input.snapshotDurationMs),
		])
	}

	rows.push(['**Migrate duration**', formatDuration(input.migrateDurationMs)])

	return `## Migrate\n\n${renderKeyValueTable(rows)}`
}
