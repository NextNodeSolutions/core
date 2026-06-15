import { atom } from 'jotai'
import { atomFamily, unwrap } from 'jotai/utils'

import { isRecord } from '@/lib/domain/is-record.ts'
import {
	ALL,
	bucketLogs,
	collectDistinct,
	countByLevel,
	filterLogs,
	nextActiveLevels,
	selectLogByKey,
} from '@/lib/domain/monitoring/log-explorer.ts'
import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type {
	LevelCounts,
	LogBucket,
	LogFilter,
} from '@/lib/domain/monitoring/log-explorer.ts'
import type { LogLevel, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * State for the dynamic /logs island. Logs are fetched ONCE per time-range
 * (`logsFamily`) and every filter / selection / histogram value is derived
 * client-side from that loaded list - no network on a chip toggle, a search
 * keystroke, a row click, or a facet change. The initial range is seeded from
 * the server (no fetch on first paint); switching back to an already-loaded
 * range is instant because the family caches each range's atom.
 */

const BUCKET_COUNT = 72
const MS_PER_HOUR = 3_600_000

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

/**
 * A stable "now" injected from the server so bucketing is deterministic and
 * matches the page's timezone handling - never `Date.now()` in a render path.
 */
export const nowMsAtom = atom(0)

// --- Per-range data loading (the only place that touches the network) ---
//
// `logsFamily` memoises one async atom per range: the seeded initial range
// resolves synchronously from the seed (no fetch, no flash), and any other
// range fetches `/api/logs` once - jotai caches the resolved value, so flipping
// back is instant. The data region reads `logsLoaderAtom` ONCE behind its
// Suspense boundary (the only thing that suspends, and only on a cold range).
// Every derived view reads `currentLogsAtom` - the loader UNWRAPPED to a sync
// value - so filtering / selection / bucketing never re-suspend; a chip toggle
// or keystroke recomputes instantly off the already-loaded list.

export interface LogsSeed {
	readonly range: string
	readonly logs: ReadonlyArray<LogLine>
}

/** Seeded once from server props; read by the loader for the initial range. */
export const seedAtom = atom<LogsSeed | null>(null)

const parseLogsResponse = (payload: unknown): ReadonlyArray<LogLine> => {
	if (!isRecord(payload) || !Array.isArray(payload.logs)) {
		throw new Error('Réponse /api/logs inattendue : champ `logs` manquant.')
	}
	// The endpoint serialises our own domain LogLine[]; trust the element shape.
	return payload.logs
}

const fetchLogsForRange = async (
	range: string,
): Promise<ReadonlyArray<LogLine>> => {
	const response = await fetch(`/api/logs?range=${encodeURIComponent(range)}`)
	if (!response.ok) {
		throw new Error(
			`Échec du chargement des logs (${String(response.status)}).`,
		)
	}
	return parseLogsResponse(await response.json())
}

const logsFamily = atomFamily((range: string) =>
	atom(async (get): Promise<ReadonlyArray<LogLine>> => {
		const seed = get(seedAtom)
		if (seed?.range === range) return seed.logs
		return fetchLogsForRange(range)
	}),
)

/** Suspends until the active range's logs are loaded (cold range = one fetch). */
export const logsLoaderAtom = atom(get => get(logsFamily(get(rangeAtom))))

/**
 * The active range's logs as a SYNC value (the loader unwrapped). During a cold
 * fetch it falls back to an empty list, but the data region is suspended then,
 * so the empty value is never shown; once loaded every view reads it instantly.
 */
export const currentLogsAtom = unwrap(
	logsLoaderAtom,
	previous => previous ?? [],
)

// --- Derived views: pure SYNC projections of the loaded logs + filter state ---

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

/** Count of filtered rows. */
export const filteredCountAtom = atom(get => get(filteredLogsAtom).length)

/** Histogram buckets over the filtered rows, using the injected `nowMs`. */
export const bucketsAtom = atom((get): LogBucket[] =>
	bucketLogs(get(filteredLogsAtom), {
		bucketCount: BUCKET_COUNT,
		windowMs: rangeToHours(get(rangeAtom)) * MS_PER_HOUR,
		nowMs: get(nowMsAtom),
	}),
)

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

/** Per-level counts for the chips, scoped by the active service / vps facets. */
export const levelCountsAtom = atom<LevelCounts>(get =>
	countByLevel(get(currentLogsAtom), {
		service: get(serviceAtom),
		vps: get(vpsAtom),
	}),
)

/** Distinct service facet options across the loaded logs. */
export const serviceOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...collectDistinct(get(currentLogsAtom), line => line.service),
])

/** Distinct vps facet options across the loaded logs. */
export const vpsOptionsAtom = atom<ReadonlyArray<string>>(get => [
	ALL,
	...collectDistinct(get(currentLogsAtom), line => line.vps),
])
