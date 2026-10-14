import { formatDuration, renderKeyValueTable } from './summary-renderer.ts'

import type { AppEnvironment } from '#/domain/environment.ts'

export type MigrateSummaryInput = {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly migrateDurationMs: number
}
export function buildMigrateSummary(input: MigrateSummaryInput): string {
	return `## Migrate\n\n${renderKeyValueTable([
		['Project', input.projectName],
		['Environment', input.environment],
		['Migrate duration', formatDuration(input.migrateDurationMs)],
	])}`
}
