import { atom } from 'jotai'
import { atomFamily, unwrap } from 'jotai/utils'

import { isRecord } from '@/lib/domain/is-record.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { OverviewWindow } from '@/lib/domain/monitoring/overview.ts'

/**
 * State for the dynamic overview island. The RANGE-DEPENDENT window (the four
 * fleet stats + the recent-log preview) is fetched ONCE per time-range: the
 * seeded initial range resolves synchronously from the server seed (no fetch,
 * no loading flash), and any other range fetches `/api/overview` once - jotai
 * caches each range's resolved value, so flipping back is instant. The single
 * data region reads `windowLoaderAtom` behind one Suspense boundary, so only
 * that block flips to a skeleton on a cold range; the range tabs stay live.
 *
 * The range-INDEPENDENT parts of the page (fleet grid, alerts, recent
 * deployments) are "now" snapshots the server renders once, outside this
 * island - they never refetch on a range change.
 */

export const rangeAtom = atom('live')

/** Seeded once from server props; read by the loader for the initial range. */
export const seedAtom = atom<OverviewWindow | null>(null)

const parseWindow = (payload: unknown, range: string): OverviewWindow => {
	if (
		!isRecord(payload) ||
		!Array.isArray(payload.stats) ||
		!Array.isArray(payload.stream) ||
		!Array.isArray(payload.notices)
	) {
		throw new Error('Réponse /api/overview inattendue : payload incomplet.')
	}
	// The endpoint serialises our own domain `OverviewWindow`; trust the element
	// shapes. `range`/`windowHours` are derived from the requested range so the
	// client never depends on the server echoing them back.
	return {
		range,
		windowHours: rangeToHours(range),
		stats: payload.stats,
		stream: payload.stream,
		notices: payload.notices,
	}
}

const fetchWindow = async (range: string): Promise<OverviewWindow> => {
	const response = await fetch(
		`/api/overview?range=${encodeURIComponent(range)}`,
	)
	if (!response.ok) {
		throw new Error(
			`Échec du chargement de la vue d'ensemble (${String(response.status)}).`,
		)
	}
	return parseWindow(await response.json(), range)
}

const windowFamily = atomFamily((range: string) =>
	atom(async (get): Promise<OverviewWindow> => {
		const seed = get(seedAtom)
		if (seed?.range === range) return seed
		return fetchWindow(range)
	}),
)

/** Suspends until the active range's window is loaded (cold range = one fetch). */
export const windowLoaderAtom = atom(get => get(windowFamily(get(rangeAtom))))

/**
 * The active window as a SYNC value (the loader unwrapped). During a cold fetch
 * it falls back to the previous window, but the data region is suspended on
 * `windowLoaderAtom` then, so that stale value is never shown; once the new
 * range resolves, this updates reactively to it. Reading the unwrapped value
 * (rather than the raw promise-valued loader) is what makes a range change
 * re-render to the new window - the same pattern as the logs island.
 */
export const currentWindowAtom = unwrap(
	windowLoaderAtom,
	previous => previous ?? null,
)
