import { isRecord } from '@/lib/domain/is-record.ts'
import {
	coerceFleetStats,
	EMPTY_FLEET_STATS,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import { ALL } from '@/lib/domain/monitoring/log-explorer.ts'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogFacets, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The /logs island's data SOURCE: how a (range + service + vps + search) filter
 * key turns into a fetched window. Pure helpers + the `/api/logs` call, kept out
 * of `atoms.ts` so the atom wiring stays focused (and under the file-size cap).
 */

export interface WindowParams {
	readonly range: string
	readonly service?: string
	readonly vps?: string
	readonly query?: string
}

/** The line sample + windowed aggregates + facet lists for one filter key. */
export interface LogsWindow {
	readonly logs: ReadonlyArray<LogLine>
	readonly stats: FleetLogStats
	readonly facets: LogFacets
}

export const EMPTY_FACETS: LogFacets = { services: [], vps: [] }
export const EMPTY_WINDOW: LogsWindow = {
	logs: [],
	stats: EMPTY_FLEET_STATS,
	facets: EMPTY_FACETS,
}

/** ALL / '' collapse to "no filter" so the key omits them and stays stable. */
export const effectiveFilter = (raw: string): string | undefined =>
	raw !== ALL && raw.length > 0 ? raw : undefined

/** Deterministic fetch key; only the SET filters appear (stable JSON order). */
export const keyOf = (params: WindowParams): string => {
	const key: {
		range: string
		service?: string
		vps?: string
		query?: string
	} = { range: params.range }
	if (params.service) key.service = params.service
	if (params.vps) key.vps = params.vps
	if (params.query) key.query = params.query
	return JSON.stringify(key)
}

const toStringList = (raw: unknown): ReadonlyArray<string> =>
	Array.isArray(raw)
		? raw.filter((entry): entry is string => typeof entry === 'string')
		: []

/** Client trust boundary for the `facets` field of /api/logs. */
const coerceFacets = (raw: unknown): LogFacets => {
	if (!isRecord(raw)) return EMPTY_FACETS
	return {
		services: toStringList(raw.services),
		vps: toStringList(raw.vps),
	}
}

const parseLogsWindow = (payload: unknown): LogsWindow => {
	if (!isRecord(payload) || !Array.isArray(payload.logs)) {
		throw new Error('Réponse /api/logs inattendue : champ `logs` manquant.')
	}
	// The endpoint serialises our own domain `LogLine[]`; trust the element
	// shape. `stats`/`facets` are coerced back through the client trust boundary.
	return {
		logs: payload.logs,
		stats: coerceFleetStats(payload.stats),
		facets: coerceFacets(payload.facets),
	}
}

export const fetchLogsWindow = async (
	params: WindowParams,
): Promise<LogsWindow> => {
	const search = new URLSearchParams({ range: params.range })
	if (params.service) search.set('service', params.service)
	if (params.vps) search.set('vps', params.vps)
	if (params.query) search.set('q', params.query)
	const response = await fetch(`/api/logs?${search.toString()}`)
	if (!response.ok) {
		throw new Error(
			`Échec du chargement des logs (${String(response.status)}).`,
		)
	}
	return parseLogsWindow(await response.json())
}
