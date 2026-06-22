import { atom } from 'jotai'
import { atomFamily, unwrap } from 'jotai/utils'

import { isRecord } from '@/lib/domain/is-record.ts'
import {
	coerceFleetStats,
	EMPTY_FLEET_STATS,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import {
	ALL,
	collectDistinct,
	filterLogs,
	nextActiveLevels,
	selectLogByKey,
} from '@/lib/domain/monitoring/log-explorer.ts'
import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogFilter } from '@/lib/domain/monitoring/log-explorer.ts'
import type { LogLevel, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * State for the dynamic /logs island. Each range fetches ONCE
 * (`logsFamily`) and yields TWO things: the recent line SAMPLE (the list) and
 * the WINDOWED aggregates (histogram + per-level + total). The split is the
 * whole fix: the sample is the 200 newest lines (range-invariant on a busy
 * fleet), so the histogram and counts now come from a server aggregate over the
 * full window instead of bucketing that capped sample. Filters / selection /
 * search are pure client-side derivations over the loaded SAMPLE - no network
 * on a chip toggle, a keystroke, a row click, or a facet change. The initial
 * range is seeded from the server (no fetch on first paint); switching back to
 * an already-loaded range is instant because the family caches each range.
 */

/** All four levels active = the default "show everything" chip state. */
const ALL_LEVELS: ReadonlySet<LogLevel> = new Set(LOG_LEVELS)

// --- Filter / selection primitives (drive the always-interactive controls) ---

export const rangeAtom = atom('6h')
export const queryAtom = atom('')
export const serviceAtom = atom(ALL)
export const vpsAtom = atom(ALL)
export const levelsAtom = atom<ReadonlySet<LogLevel>>(ALL_LEVELS)
export const selAtom = atom<string | null>(null)

/**
 * Toggle one level using the "isolate-then-additive" semantics: from the
 * all-active default a click isolates to that level (click ERROR -> see
 * errors, not "everything except errors"); thereafter it is an additive
 * multi-select, and removing the last active level snaps back to all so the
 * screen never goes blank. The transition itself is the pure, unit-tested
 * `nextActiveLevels`; this write-atom only wires state to it.
 */
export const toggleLevelAtom = atom(null, (get, set, level: LogLevel) => {
	set(levelsAtom, nextActiveLevels(get(levelsAtom), LOG_LEVELS, level))
})

// --- Per-range data loading (the only place that touches the network) ---
//
// `logsFamily` memoises one async atom per range, resolving a `LogsWindow`: the
// seeded initial range resolves synchronously from the seed (no fetch, no
// flash), and any other range fetches `/api/logs` once - jotai caches the
// resolved value, so flipping back is instant. The data region reads
// `logsLoaderAtom` ONCE behind its Suspense boundary (the only thing that
// suspends, and only on a cold range). The sample-derived views read
// `currentLogsAtom`; the histogram / chips / total read `currentStatsAtom` -
// both UNWRAPPED to sync values - so a filter or selection recomputes instantly.

/** The recent line sample + the windowed aggregates for one range. */
interface LogsWindow {
	readonly logs: ReadonlyArray<LogLine>
	readonly stats: FleetLogStats
}

const EMPTY_WINDOW: LogsWindow = { logs: [], stats: EMPTY_FLEET_STATS }

export interface LogsSeed {
	readonly range: string
	readonly logs: ReadonlyArray<LogLine>
	readonly stats: FleetLogStats
}

/** Seeded once from server props; read by the loader for the initial range. */
export const seedAtom = atom<LogsSeed | null>(null)

const parseLogsWindow = (payload: unknown): LogsWindow => {
	if (!isRecord(payload) || !Array.isArray(payload.logs)) {
		throw new Error('Réponse /api/logs inattendue : champ `logs` manquant.')
	}
	// The endpoint serialises our own domain `LogLine[]`; trust the element
	// shape. `stats` is coerced back through the client trust boundary.
	return { logs: payload.logs, stats: coerceFleetStats(payload.stats) }
}

const fetchLogsWindow = async (range: string): Promise<LogsWindow> => {
	const response = await fetch(`/api/logs?range=${encodeURIComponent(range)}`)
	if (!response.ok) {
		throw new Error(
			`Échec du chargement des logs (${String(response.status)}).`,
		)
	}
	return parseLogsWindow(await response.json())
}

const logsFamily = atomFamily((range: string) =>
	atom(async (get): Promise<LogsWindow> => {
		const seed = get(seedAtom)
		if (seed?.range === range) return { logs: seed.logs, stats: seed.stats }
		return fetchLogsWindow(range)
	}),
)

/** Suspends until the active range's window is loaded (cold range = one fetch). */
export const logsLoaderAtom = atom(get => get(logsFamily(get(rangeAtom))))

/**
 * The active range's window as a SYNC value (the loader unwrapped). During a
 * cold fetch it falls back to the empty window, but the data region is
 * suspended on `logsLoaderAtom` then, so that empty value is never shown; once
 * loaded every view reads it instantly.
 */
const currentWindowAtom = unwrap(
	logsLoaderAtom,
	previous => previous ?? EMPTY_WINDOW,
)

/** The loaded line sample (list + facets + selection derive from this). */
export const currentLogsAtom = atom(get => get(currentWindowAtom).logs)

/** The windowed aggregates (histogram + per-level + total). */
export const currentStatsAtom = atom(get => get(currentWindowAtom).stats)

// --- Derived views: pure SYNC projections of the loaded data + filter state ---

const filterAtom = atom<LogFilter>(get => ({
	query: get(queryAtom),
	levels: [...get(levelsAtom)],
	service: get(serviceAtom),
	vps: get(vpsAtom),
}))

/** Filtered rows for the list - sync, recomputed on any filter change. */
export const filteredLogsAtom = atom(get =>
	filterLogs(get(currentLogsAtom), get(filterAtom)),
)

/** Count of filtered rows in the sample (the list size). */
export const filteredCountAtom = atom(get => get(filteredLogsAtom).length)

/** Windowed histogram buckets - server aggregate, redrawn per range. */
export const bucketsAtom = atom(get => get(currentStatsAtom).buckets)

/** Total lines across the window (the volume header), not the sample size. */
export const windowTotalAtom = atom(get => get(currentStatsAtom).total)

/**
 * Per-key "is this row selected" booleans. A row subscribes only to its own
 * atom, so changing the selection re-renders just the two affected rows (the
 * old and the new), never the whole list.
 */
export const isSelectedFamily = atomFamily((key: string) =>
	atom(get => get(selAtom) === key),
)

/** The selected line resolved by its stable key against the filtered rows. */
export const selectedLogAtom = atom((get): LogLine | null => {
	const key = get(selAtom)
	if (key === null) return null
	return selectLogByKey(get(filteredLogsAtom), key)
})

/** Per-level counts for the chips - the WINDOWED tally, not the sample's. */
export const levelCountsAtom = atom(get => get(currentStatsAtom).levelCounts)

/** Distinct service facet options across the loaded sample. */
export const serviceOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...collectDistinct(get(currentLogsAtom), line => line.service),
])

/** Distinct vps facet options across the loaded sample. */
export const vpsOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...collectDistinct(get(currentLogsAtom), line => line.vps),
])
