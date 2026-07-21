import { atom } from 'jotai'
import { atomFamily, unwrap } from 'jotai/utils'

import {
	effectiveFilter,
	EMPTY_WINDOW,
	fetchLogsWindow,
	keyOf,
} from '@/islands/logs/window-source.ts'
import {
	ALL,
	nextActiveLevels,
	selectLogByKey,
} from '@/lib/domain/monitoring/log-explorer.ts'
import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'

import type { LogsWindow, WindowParams } from '@/islands/logs/window-source.ts'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type {
	LogFacets,
	LogLevel,
	LogLine,
} from '@/lib/domain/monitoring/log-query.ts'

/**
 * State for the dynamic /logs island. The SERVER does the windowing AND the
 * facet/search filtering: a fetch is keyed by (range, service, vps, search), so
 * the line SAMPLE (list), the windowed aggregates (histogram + per-level +
 * total) AND the facet value lists all come back already scoped to the
 * operator's choices - no client-side facet drift, no chip/list contradiction.
 * Only the LEVEL chips stay a client-side list refinement (instant, no refetch):
 * the histogram keeps showing the full level distribution while clicking a level
 * narrows the rows. The search box is debounced before it re-keys the fetch. The
 * initial range is seeded from the server (no fetch on first paint). The fetch
 * plumbing lives in `window-source.ts`.
 */

/** All four levels active = the default "show everything" chip state. */
const ALL_LEVELS: ReadonlySet<LogLevel> = new Set(LOG_LEVELS)

// --- Filter / selection primitives (drive the always-interactive controls) ---

export const rangeAtom = atom('6h')
/** The live search input value (updates per keystroke for the text field). */
export const queryAtom = atom('')
/** The debounced search that actually re-keys the fetch (set by FilterBar). */
export const debouncedQueryAtom = atom('')
export const serviceAtom = atom(ALL)
export const vpsAtom = atom(ALL)
export const levelsAtom = atom<ReadonlySet<LogLevel>>(ALL_LEVELS)
export const selAtom = atom<string | null>(null)

/**
 * Toggle one level using the "isolate-then-additive" semantics: from the
 * all-active default a click isolates to that level (click ERROR -> see
 * errors, not "everything except errors"); thereafter it is an additive
 * multi-select, and removing the last active level snaps back to all so the
 * screen never goes blank. Pure transition is the unit-tested `nextActiveLevels`.
 */
export const toggleLevelAtom = atom(null, (get, set, level: LogLevel) => {
	set(levelsAtom, nextActiveLevels(get(levelsAtom), LOG_LEVELS, level))
})

// --- Per-filter data loading (the only place that touches the network) ---

export interface LogsSeed {
	readonly range: string
	readonly logs: ReadonlyArray<LogLine>
	readonly stats: FleetLogStats
	readonly facets: LogFacets
}

/** Seeded once from server props; the loader returns it for the initial range. */
export const seedAtom = atom<LogsSeed | null>(null)

export const fetchKeyAtom = atom(get =>
	keyOf({
		range: get(rangeAtom),
		service: effectiveFilter(get(serviceAtom)),
		vps: effectiveFilter(get(vpsAtom)),
		query: effectiveFilter(get(debouncedQueryAtom)),
	}),
)

/**
 * One async atom per filter key: the seeded initial range (no filters) resolves
 * synchronously; any other key fetches `/api/logs` once and is cached, so
 * flipping back is instant. `logsLoaderAtom` is the single Suspense point.
 */
const windowFamily = atomFamily((key: string) =>
	atom(async (get): Promise<LogsWindow> => {
		const params: WindowParams = JSON.parse(key)
		const seed = get(seedAtom)
		const unfiltered =
			typeof params.service === 'undefined' &&
			typeof params.vps === 'undefined' &&
			typeof params.query === 'undefined'
		if (seed && unfiltered && seed.range === params.range) {
			return { logs: seed.logs, stats: seed.stats, facets: seed.facets }
		}
		return fetchLogsWindow(params)
	}),
)

/** Suspends until the active filter key's window is loaded (cold key = a fetch). */
export const logsLoaderAtom = atom(get => get(windowFamily(get(fetchKeyAtom))))

/**
 * The active window as a SYNC value (the loader unwrapped). During a cold fetch
 * it falls back to the PREVIOUS window, so the facet dropdowns (outside the
 * Suspense boundary) keep their values mid-refetch; the data region is suspended
 * then, so the stale sample/stats are never shown in the list.
 */
const currentWindowAtom = unwrap(
	logsLoaderAtom,
	previous => previous ?? EMPTY_WINDOW,
)

/** The loaded line sample (already server-filtered by service/vps/search). */
export const currentLogsAtom = atom(get => get(currentWindowAtom).logs)

/** The windowed aggregates (histogram + per-level + total), server-filtered. */
export const currentStatsAtom = atom(get => get(currentWindowAtom).stats)

/** Distinct facet values over the window (unscoped by the current selection). */
export const currentFacetsAtom = atom(get => get(currentWindowAtom).facets)

// --- Derived views: LEVEL is the only client-side refinement of the sample ---

/**
 * The list rows: the server-filtered sample narrowed by the active LEVEL chips
 * (client-side, instant). A null-level line always passes; all-active shows all.
 */
export const filteredLogsAtom = atom(get => {
	const levels = get(levelsAtom)
	if (levels.size === LOG_LEVELS.length) return get(currentLogsAtom)
	return get(currentLogsAtom).filter(
		line => line.level === null || levels.has(line.level),
	)
})

/** Count of visible rows (the "X lignes" label). */
export const filteredCountAtom = atom(get => get(filteredLogsAtom).length)

/** Windowed histogram buckets - server aggregate, redrawn per filter. */
export const bucketsAtom = atom(get => get(currentStatsAtom).buckets)

/** Total lines across the windowed + facet-filtered query (the volume header). */
export const windowTotalAtom = atom(get => get(currentStatsAtom).total)

/**
 * Per-key "is this row selected" booleans. A row subscribes only to its own
 * atom, so changing the selection re-renders just the two affected rows.
 */
export const isSelectedFamily = atomFamily((key: string) =>
	atom(get => get(selAtom) === key),
)

/** The selected line resolved by its stable key against the visible rows. */
export const selectedLogAtom = atom((get): LogLine | null => {
	const key = get(selAtom)
	if (key === null) return null
	return selectLogByKey(get(filteredLogsAtom), key)
})

/** Per-level counts for the chips - the windowed, facet-scoped tally. */
export const levelCountsAtom = atom(get => get(currentStatsAtom).levelCounts)

/** Service facet options from the server facet list (window-wide, unscoped). */
export const serviceOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...get(currentFacetsAtom).services,
])

/** Vps facet options from the server facet list (window-wide, unscoped). */
export const vpsOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...get(currentFacetsAtom).vps,
])
