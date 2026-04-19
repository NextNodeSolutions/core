const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const TENTHS_DIVISOR = 100

export type SummaryRow = readonly [string, string]

/** Render a two-column markdown table — used by every GITHUB_STEP_SUMMARY writer. */
export function renderKeyValueTable(rows: ReadonlyArray<SummaryRow>): string {
	const header = '| | |'
	const separator = '|---|---|'
	const body = rows.map(([key, value]) => `| ${key} | ${value} |`).join('\n')

	return `${header}\n${separator}\n${body}`
}

/** Human-readable duration — `850ms`, `4.2s`, `3m`, `3m 5s`. */
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

export interface ResourceOutcomeLike {
	readonly outcome: Readonly<Record<string, { readonly detail: string }>>
	readonly durationMs: number
}

/**
 * Build the standard summary rows shared by provision/teardown summaries:
 * one row per managed resource, followed by `Target` and `Duration` rows.
 */
export function buildResourceOutcomeRows(
	result: ResourceOutcomeLike,
	targetName: string,
): ReadonlyArray<SummaryRow> {
	const rows: Array<SummaryRow> = []

	for (const [resource, outcome] of Object.entries(result.outcome)) {
		rows.push([`**${resource}**`, outcome.detail])
	}

	rows.push(['**Target**', targetName])
	rows.push(['**Duration**', formatDuration(result.durationMs)])

	return rows
}
