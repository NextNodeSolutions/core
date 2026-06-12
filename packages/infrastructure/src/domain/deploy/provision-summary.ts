import {
	buildResourceOutcomeRows,
	renderKeyValueTable,
} from './summary-renderer.ts'

import type { ProvisionResult } from './target.ts'

export function buildProvisionSummary(
	provisionResult: ProvisionResult,
	projectName: string,
	targetName: string,
): string {
	const heading = `### :white_check_mark: Infrastructure ready for \`${projectName}\``
	const table = renderKeyValueTable(
		buildResourceOutcomeRows(provisionResult, targetName),
	)

	return `${heading}\n\n${table}`
}
