import type { DeployedEnvironment, DeployResult } from './target.ts'

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const TENTHS_DIVISOR = 100

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
): ReadonlyArray<readonly [string, string]> {
	const rows: Array<readonly [string, string]> = [['**URL**', env.url]]

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

function renderKeyValueTable(
	rows: ReadonlyArray<readonly [string, string]>,
): string {
	const header = '| | |'
	const separator = '|---|---|'
	const body = rows.map(([key, value]) => `| ${key} | ${value} |`).join('\n')

	return `${header}\n${separator}\n${body}`
}

export function formatDuration(ms: number): string {
	if (ms < MS_PER_SECOND) return `${String(ms)}ms`

	const totalSeconds = Math.floor(ms / MS_PER_SECOND)
	if (totalSeconds < SECONDS_PER_MINUTE) {
		const tenths = Math.floor((ms % MS_PER_SECOND) / TENTHS_DIVISOR)
		return `${String(totalSeconds)}.${String(tenths)}s`
	}

	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
	const seconds = totalSeconds % SECONDS_PER_MINUTE
	if (seconds === 0) return `${String(minutes)}m`
	return `${String(minutes)}m ${String(seconds)}s`
}
