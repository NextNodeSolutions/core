import { ALL } from '@/lib/domain/monitoring/log-explorer.ts'
import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'

import type { LogLevel } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Pure query-param logic for the /logs screen: parse the `levels` param and
 * serialise filter state back into hrefs. The component reads Astro.params,
 * hands the values here, and renders the returned strings - no logic lives in
 * the markup.
 */

/** Default range; omitted from the URL so the canonical view has no query. */
export const DEFAULT_RANGE = '6h'

export interface LogsQuery {
	readonly q: string
	readonly service: string
	readonly vps: string
	readonly levelsParam: string
	readonly range: string
}

const LEVEL_NAMES: ReadonlySet<string> = new Set(LOG_LEVELS)

const isLogLevel = (candidate: string): candidate is LogLevel =>
	LEVEL_NAMES.has(candidate)

/**
 * Parse the comma-separated `levels` param into canonical levels. An empty or
 * fully-unrecognised param means "all levels" (no chip filter applied).
 */
export const parseLogLevels = (raw: string): ReadonlyArray<LogLevel> => {
	const requested = raw
		.split(',')
		.map(part => part.trim())
		.filter(isLogLevel)
	return requested.length > 0 ? requested : LOG_LEVELS
}

/**
 * Build a /logs href from the current query plus overrides. A null override
 * deletes that key. Defaults (`all` scope, the default range, empty query) are
 * omitted so the canonical view stays at a bare `/logs`.
 */
export const buildLogsHref = (
	query: LogsQuery,
	overrides: Readonly<Record<string, string | null>>,
): string => {
	const params = new URLSearchParams()
	if (query.q) params.set('q', query.q)
	if (query.service !== ALL) params.set('service', query.service)
	if (query.vps !== ALL) params.set('vps', query.vps)
	if (query.levelsParam) params.set('levels', query.levelsParam)
	if (query.range !== DEFAULT_RANGE) params.set('range', query.range)
	for (const [key, override] of Object.entries(overrides)) {
		if (override === null) params.delete(key)
		else params.set(key, override)
	}
	const queryString = params.toString()
	return queryString ? `/logs?${queryString}` : '/logs'
}

/**
 * Toggle one level on/off against the active set and return the resulting
 * /logs href. When every level ends up on, the `levels` param collapses to
 * empty (the canonical "all" state) rather than listing them all.
 */
export const toggleLevelHref = (
	query: LogsQuery,
	activeLevels: ReadonlyArray<LogLevel>,
	level: LogLevel,
): string => {
	const next = activeLevels.includes(level)
		? activeLevels.filter(active => active !== level)
		: [...activeLevels, level]
	const ordered = LOG_LEVELS.filter(candidate => next.includes(candidate))
	const allOn = ordered.length === LOG_LEVELS.length
	return buildLogsHref(query, {
		levels: allOn ? '' : ordered.join(','),
		sel: null,
	})
}
