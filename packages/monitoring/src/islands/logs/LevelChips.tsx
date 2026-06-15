import { useAtomValue, useSetAtom } from 'jotai'

import {
	filteredCountAtom,
	levelCountsAtom,
	levelsAtom,
	rangeAtom,
	toggleLevelAtom,
} from '@/islands/logs/atoms.ts'
import { levelBadgeClass } from '@/islands/logs/level-styles.ts'
import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The four level chips: a log-viewer "isolate-then-additive" filter. All four
 * active = "show everything" (the default), and in that unfiltered state the
 * chips read as NEUTRAL so the operator sees there is no level filter yet -
 * clicking one then isolates to that level (click ERROR -> see errors) and
 * highlights it. Once filtered, each chip highlights when its level is active.
 * The transition lives in `toggleLevelAtom`; this only renders state. The
 * trailing filtered-line count and the live badge keep this row's layout.
 */

export function LevelChips(): React.ReactElement {
	const activeLevels = useAtomValue(levelsAtom)
	const counts = useAtomValue(levelCountsAtom)
	const filteredCount = useAtomValue(filteredCountAtom)
	const range = useAtomValue(rangeAtom)
	const toggleLevel = useSetAtom(toggleLevelAtom)

	// "Unfiltered" = every level active (the default). Then no chip is
	// highlighted, so "all active" is visually distinct from an isolated level.
	const isFiltered = activeLevels.size < LOG_LEVELS.length

	return (
		<div className="flex flex-wrap items-center gap-2">
			{LOG_LEVELS.map(level => {
				const active = isFiltered && activeLevels.has(level)
				return (
					<button
						type="button"
						key={level}
						aria-pressed={active}
						aria-label={`niveau ${level}`}
						onClick={() => toggleLevel(level)}
						className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
							active
								? levelBadgeClass[level]
								: 'border-base-200 text-base-500 hover:bg-base-50 bg-white'
						}`}
					>
						<span
							className={`size-1.5 rounded-full ${
								active ? 'bg-current' : 'bg-base-300'
							}`}
						/>
						<span className="uppercase">{level}</span>
						<span className="font-mono opacity-70">
							{counts[level]}
						</span>
					</button>
				)
			})}
			<div className="flex-1" />
			<span className="text-base-500 font-mono text-xs">
				{filteredCount} lignes
			</span>
			{range === 'live' && (
				<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
					<span className="size-1.5 rounded-full bg-emerald-600" />
					live tail
				</span>
			)}
		</div>
	)
}
