import { useAtomValue, useSetAtom } from 'jotai'

import { selAtom, selectedLogAtom } from '@/islands/logs/atoms.ts'
import { levelBadgeClass } from '@/islands/logs/level-styles.ts'
import { LogDetailBody } from '@/islands/logs/LogDetailBody.tsx'
import { LogIcon } from '@/islands/logs/LogIcon.tsx'

import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The right-hand detail panel for the selected log. Replaces the old `?sel=`
 * navigation: it reads the resolved selection from state, renders the sticky
 * level header + close button, and delegates the scrollable content to
 * LogDetailBody. Closing clears `selAtom`. Renders nothing when no row is
 * selected.
 */

const CLOSE_ICON_SIZE = 16

const headerBadgeClass = (log: LogLine): string =>
	log.level === null
		? 'border-base-200 bg-base-100 text-base-600'
		: levelBadgeClass[log.level]

export function LogDetailPanel(): React.ReactElement | null {
	const selectedLog = useAtomValue(selectedLogAtom)
	const setSel = useSetAtom(selAtom)

	if (selectedLog === null) return null

	return (
		<div className="border-base-200 flex w-[380px] flex-none flex-col overflow-auto border-l bg-white">
			<div className="border-base-200 sticky top-0 z-2 flex items-center justify-between border-b bg-white px-4 py-3">
				<span
					className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase ${headerBadgeClass(selectedLog)}`}
				>
					{selectedLog.level ?? 'log'}
				</span>
				<button
					type="button"
					onClick={() => setSel(null)}
					className="text-base-500 hover:bg-base-50 hover:text-base-900 rounded-full p-1"
					aria-label="Fermer le détail"
				>
					<LogIcon name="x" size={CLOSE_ICON_SIZE} />
				</button>
			</div>

			<LogDetailBody log={selectedLog} />
		</div>
	)
}
