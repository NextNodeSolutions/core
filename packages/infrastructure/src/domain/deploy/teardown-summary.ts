import {
	buildResourceOutcomeRows,
	renderKeyValueTable,
} from './summary-renderer.ts'

import type { TeardownResult } from './teardown-result.ts'

export function buildTeardownSummary(
	teardownResult: TeardownResult,
	projectName: string,
	targetName: string,
): string {
	const heading = `### :wastebasket: Infrastructure torn down for \`${projectName}\``
	const table = renderKeyValueTable(
		buildResourceOutcomeRows(teardownResult, targetName),
	)

	return `${heading}\n\n${table}`
}
