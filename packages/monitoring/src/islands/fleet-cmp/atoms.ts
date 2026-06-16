import { atom } from 'jotai'
import { atomFamily, unwrap } from 'jotai/utils'

import { CHART_COLORS } from '@/components/charts/chart-color.ts'
import { DEFAULT_CMP_METRIC } from '@/islands/fleet-cmp/metrics.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

import type { ChartColor } from '@/components/charts/chart-color.ts'
import type { CmpMetric } from '@/islands/fleet-cmp/metrics.ts'
import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * State for the dynamic fleet-comparison panel. Each metric's per-peer series
 * is fetched ONCE (`cmpFamily`) and the chart / legend are derived client-side
 * from that loaded list - switching the metric tab never reloads the page.
 * The initial metric (cpu) is seeded from the server (no fetch on first paint);
 * switching back to an already-loaded metric is instant because the family
 * caches each metric's atom. Mirrors the logs island's data-loading shape.
 */

const FLEET_COLORS: ReadonlyArray<ChartColor> = [
	'accent',
	'info',
	'warning',
	'slate',
	'danger',
]

/** A legend/chart series with its assigned color and current-host highlight. */
export interface CmpSeries {
	readonly name: string
	readonly color: ChartColor
	readonly values: ReadonlyArray<number>
	readonly isCurrent: boolean
}

// --- Selection + seeded context (drive the always-interactive controls) ---

/** The currently compared metric. Switching it triggers the per-metric load. */
export const metricAtom = atom<CmpMetric>(DEFAULT_CMP_METRIC)

/** The VPS the page is showing; used to mark its legend entry `(actuel)`. */
export const slugAtom = atom('')

/** The query range, seeded from the page (stays a server param for now). */
export const rangeAtom = atom('live')

// --- Per-metric data loading (the only place that touches the network) ---

export interface CmpSeed {
	readonly metric: CmpMetric
	readonly lines: ReadonlyArray<CmpLine>
}

/** Seeded once from server props; read by the loader for the initial metric. */
export const seedAtom = atom<CmpSeed | null>(null)

const parseCmpResponse = (payload: unknown): ReadonlyArray<CmpLine> => {
	if (!isRecord(payload) || !Array.isArray(payload.lines)) {
		throw new Error(
			'Réponse /api/vps/[slug]/cmp inattendue : champ `lines` manquant.',
		)
	}
	// The endpoint serialises our own domain CmpLine[]; trust the element shape.
	return payload.lines
}

const fetchCmpLines = async (
	slug: string,
	metric: CmpMetric,
	range: string,
): Promise<ReadonlyArray<CmpLine>> => {
	const query = `metric=${metric}&range=${encodeURIComponent(range)}`
	const response = await fetch(
		`/api/vps/${encodeURIComponent(slug)}/cmp?${query}`,
	)
	if (!response.ok) {
		throw new Error(
			`Échec du chargement de la comparaison (${String(response.status)}).`,
		)
	}
	return parseCmpResponse(await response.json())
}

const cmpFamily = atomFamily((metric: CmpMetric) =>
	atom(async (get): Promise<ReadonlyArray<CmpLine>> => {
		const seed = get(seedAtom)
		if (seed?.metric === metric) return seed.lines
		return fetchCmpLines(get(slugAtom), metric, get(rangeAtom))
	}),
)

/** Suspends until the active metric's lines are loaded (cold metric = one fetch). */
export const cmpLoaderAtom = atom(get => get(cmpFamily(get(metricAtom))))

/**
 * The active metric's lines as a SYNC value (the loader unwrapped). During a
 * cold fetch it falls back to an empty list, but the chart region is suspended
 * then, so the empty value is never shown; once loaded the chart + legend read
 * it instantly.
 */
const currentLinesAtom = unwrap(cmpLoaderAtom, previous => previous ?? [])

/**
 * The chart/legend series: each loaded line tagged with its fleet color (by
 * stable index) and whether it is the current host. Pure derivation off the
 * loaded lines + the seeded slug - recomputes with no network when either the
 * metric's data or the slug changes.
 */
export const chartSeriesAtom = atom<ReadonlyArray<CmpSeries>>(get => {
	const slug = get(slugAtom)
	return get(currentLinesAtom).map((line, index) => ({
		name: line.name,
		color: FLEET_COLORS[index % FLEET_COLORS.length] ?? 'accent',
		values: line.values,
		isCurrent: line.name === slug,
	}))
})

/** Tailwind dot class for a legend chip, derived from the chart stroke color. */
export const legendDotClass = (color: ChartColor): string =>
	CHART_COLORS[color].fill.replace('fill-', 'bg-')
