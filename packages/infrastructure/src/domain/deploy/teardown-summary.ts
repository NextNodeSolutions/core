import { formatDuration } from './deploy-summary.ts'
import type { TeardownResult } from './target.ts'

export function buildTeardownSummary(
	result: TeardownResult,
	projectName: string,
	targetName: string,
): string {
	const heading = `### :wastebasket: Infrastructure torn down for \`${projectName}\``
	const rows = buildSummaryRows(result, targetName)
	const table = renderKeyValueTable(rows)

	return `${heading}\n\n${table}`
}

function buildSummaryRows(
	result: TeardownResult,
	targetName: string,
): ReadonlyArray<readonly [string, string]> {
	const rows: Array<readonly [string, string]> = []

	for (const [resource, outcome] of Object.entries(result.outcome)) {
		rows.push([`**${resource}**`, outcome.detail])
	}

	rows.push(['**Target**', targetName])
	rows.push(['**Duration**', formatDuration(result.durationMs)])

	return rows
}

function renderKeyValueTable(
	rows: ReadonlyArray<readonly [string, string]>,
): string {
	const header = '| | |'
	const separator = '|---|---|'
	const body = rows.map(([key, value]) => `| ${key} | ${value} |`).join('\n')

	return `${header}\n${separator}\n${body}`
}
