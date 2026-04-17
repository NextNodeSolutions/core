import { formatDuration } from './deploy-summary.ts'
import type { ProvisionResult } from './target.ts'

export function buildProvisionSummary(
	result: ProvisionResult,
	projectName: string,
	targetName: string,
): string {
	const heading = `### :white_check_mark: Infrastructure ready for \`${projectName}\``
	const rows = buildSummaryRows(result, targetName)
	const table = renderKeyValueTable(rows)

	return `${heading}\n\n${table}`
}

function buildSummaryRows(
	result: ProvisionResult,
	targetName: string,
): ReadonlyArray<readonly [string, string]> {
	const rows: Array<readonly [string, string]> = []

	if (result.kind === 'vps') {
		rows.push([
			'**Server**',
			`#${String(result.serverId)} (${result.serverType} / ${result.location})`,
		])
		rows.push(['**Public IP**', result.publicIp])
		rows.push(['**Tailnet IP**', result.tailnetIp])
	}

	if (result.kind === 'static') {
		rows.push(['**Pages project**', result.pagesProjectName])
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
