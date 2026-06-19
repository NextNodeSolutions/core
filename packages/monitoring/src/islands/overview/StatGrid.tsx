import { StatCard } from '@/islands/overview/StatCard.tsx'

import type { FleetStat } from '@/lib/domain/monitoring/fleet-overview.ts'

/**
 * The four fleet stats as a criticality-aware, responsive grid.
 *
 * - Base 1 col, `sm` 2 cols, `lg` 4 cols - so it stays readable from phone to
 *   wide desktop.
 * - A `danger` stat is ELEVATED to span two columns (a "hero" card) so a
 *   critical number commands twice the width; everything else stays one column.
 * - Elevated cards are sorted to the FRONT, so a 2-col card never opens a hole
 *   mid-row. When nothing is critical (the common case) the order is unchanged
 *   and the grid reads as one clean, uniform row - the homogeneous default.
 *
 * Each stat carries its own `icon` (set by `summarizeFleet`), so reordering
 * here never desyncs the glyph from the stat - the grid only decides placement.
 */

interface DisplayStat {
	readonly stat: FleetStat
	readonly isElevated: boolean
}

const toDisplayStats = (
	stats: ReadonlyArray<FleetStat>,
): ReadonlyArray<DisplayStat> => {
	const decorated = stats.map(stat => ({
		stat,
		isElevated: stat.tone === 'danger',
	}))
	return decorated.toSorted(
		(left, right) => Number(right.isElevated) - Number(left.isElevated),
	)
}

interface StatGridProps {
	readonly stats: ReadonlyArray<FleetStat>
}

export function StatGrid({ stats }: StatGridProps): React.ReactElement {
	const display = toDisplayStats(stats)
	return (
		<div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
			{display.map(({ stat, isElevated }) => (
				<StatCard
					key={stat.label}
					stat={stat}
					className={isElevated ? 'sm:col-span-2 lg:col-span-2' : ''}
				/>
			))}
		</div>
	)
}
