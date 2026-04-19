import {
	buildResourceOutcomeRows,
	renderKeyValueTable,
} from './summary-renderer.ts'
import type { ProvisionResult } from './target.ts'

export function buildProvisionSummary(
	result: ProvisionResult,
	projectName: string,
	targetName: string,
): string {
	const heading = `### :white_check_mark: Infrastructure ready for \`${projectName}\``
	const table = renderKeyValueTable(
		buildResourceOutcomeRows(result, targetName),
	)

	return `${heading}\n\n${table}`
}
