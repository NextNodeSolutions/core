import type { SummaryRow } from './summary-renderer.ts'
import { formatDuration, renderKeyValueTable } from './summary-renderer.ts'
import type { DeployedEnvironment, DeployResult } from './target.ts'

export { formatDuration } from './summary-renderer.ts'

export function buildDeploySummary(
	result: DeployResult,
	targetName: string,
): string {
	const env = result.deployedEnvironments[0]
	if (!env) {
		return `### :rocket: Deploy complete for \`${result.projectName}\``
	}

	const heading = `### :rocket: Deployed \`${result.projectName}\` to ${env.name}`
	const rows = buildSummaryRows(env, targetName, result.durationMs)
	const table = renderKeyValueTable(rows)

	return `${heading}\n\n${table}`
}

function buildSummaryRows(
	env: DeployedEnvironment,
	targetName: string,
	durationMs: number,
): ReadonlyArray<SummaryRow> {
	const rows: Array<SummaryRow> = [['**URL**', env.url]]

	if (env.kind === 'container') {
		const ref = env.imageRef
		rows.push([
			'**Image**',
			`\`${ref.registry}/${ref.repository}:${ref.tag}\``,
		])
	}

	rows.push(['**Target**', targetName])
	rows.push(['**Duration**', formatDuration(durationMs)])

	return rows
}
