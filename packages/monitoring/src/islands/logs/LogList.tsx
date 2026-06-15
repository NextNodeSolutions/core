import { useAtomValue } from 'jotai'

import { filteredLogsAtom } from '@/islands/logs/atoms.ts'
import { LogRow } from '@/islands/logs/LogRow.tsx'
import { logLineKey } from '@/lib/domain/monitoring/log-explorer.ts'

/**
 * The scrollable log table. Reads the filtered rows (suspends with the active
 * range's logs), caps the rendered rows at MAX_ROWS with the original overflow
 * note, and shows the "no match" empty state. Selection lives in each row's own
 * atom, so this list does NOT subscribe to the selection and a row click never
 * re-renders the whole table.
 */

const MAX_ROWS = 250

export function LogList(): React.ReactElement {
	const filtered = useAtomValue(filteredLogsAtom)

	if (filtered.length === 0) {
		return (
			<div className="text-base-400 px-3.5 py-16 text-center text-sm">
				Aucun log ne correspond aux filtres.
			</div>
		)
	}

	const visibleRows = filtered.slice(0, MAX_ROWS)
	const overflowCount = filtered.length - MAX_ROWS

	return (
		<>
			{visibleRows.map(line => {
				const lineKey = logLineKey(line)
				return <LogRow key={lineKey} line={line} lineKey={lineKey} />
			})}
			{overflowCount > 0 && (
				<div className="text-base-400 px-3.5 py-4 text-center text-xs">
					+ {overflowCount} lignes plus anciennes - affinez les
					filtres
				</div>
			)}
		</>
	)
}
