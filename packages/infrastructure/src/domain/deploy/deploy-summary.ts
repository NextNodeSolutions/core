import { formatDuration, renderKeyValueTable } from './summary-renderer.ts'

import type { SummaryRow } from './summary-renderer.ts'
import type { DeployedEnvironment, DeployResult } from './target.ts'

export { formatDuration } from './summary-renderer.ts'

export function buildDeploySummary(
	deployResult: DeployResult,
	targetName: string,
): string {
	const [env] = deployResult.deployedEnvironments
	if (!env) {
		return `### :rocket: Deploy complete for \`${deployResult.projectName}\``
	}

	const heading = `### :rocket: Deployed \`${deployResult.projectName}\` to ${env.name}`
	const rows = buildSummaryRows(env, targetName, deployResult.durationMs)
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
		for (const [name, ref] of Object.entries(env.imageRefs)) {
			rows.push([
				`**Image (${name})**`,
				`\`${ref.registry}/${ref.repository}:${ref.tag}\``,
			])
		}
	}

	rows.push(['**Target**', targetName])
	rows.push(['**Duration**', formatDuration(durationMs)])

	return rows
}
