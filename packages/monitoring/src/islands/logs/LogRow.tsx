import { useAtomValue, useSetAtom } from 'jotai'

import { isSelectedFamily, selAtom } from '@/islands/logs/atoms.ts'
import {
	levelBorderClass,
	levelTextClass,
	statusTextClass,
} from '@/islands/logs/level-styles.ts'
import { formatTime } from '@/lib/domain/monitoring/format.ts'

import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * One log row. Clicking it selects the line (sets `selAtom`) - no navigation.
 * The row reads only its own selection boolean from `isSelectedFamily`, so a
 * selection change re-renders just this row, not the whole list. Styling
 * mirrors the original anchor row, including the active left-border tint.
 */

const activeBorderClass = (line: LogLine): string => {
	if (line.level !== null)
		return `${levelBorderClass[line.level]} bg-base-100`
	return 'border-l-base-300 bg-base-100'
}

interface LogRowProps {
	readonly line: LogLine
	readonly lineKey: string
}

export function LogRow({ line, lineKey }: LogRowProps): React.ReactElement {
	const active = useAtomValue(isSelectedFamily(lineKey))
	const setSel = useSetAtom(selAtom)

	return (
		<button
			type="button"
			onClick={() => setSel(lineKey)}
			className={`flex w-full items-baseline gap-2.5 border-l-2 px-3.5 py-1 text-left font-mono text-xs whitespace-nowrap ${
				active
					? activeBorderClass(line)
					: 'hover:bg-base-50 border-l-transparent'
			}`}
		>
			<span className="text-base-400 flex-none">
				{formatTime(Date.parse(line.time))}
			</span>
			<span
				className={`w-12 flex-none text-[10.5px] font-bold uppercase ${
					line.level === null
						? 'text-base-400'
						: levelTextClass[line.level]
				}`}
			>
				{line.level ?? '·'}
			</span>
			<span className="text-base-500 w-28 flex-none overflow-hidden text-ellipsis">
				{line.service ?? ''}
			</span>
			{line.status !== null && (
				<span
					className={`flex-none font-bold ${statusTextClass(line.status)}`}
				>
					{line.status}
				</span>
			)}
			<span className="text-base-800 flex-1 overflow-hidden text-ellipsis">
				{line.message}
			</span>
			{line.durationMs !== null && (
				<span className="text-base-400 flex-none">
					{line.durationMs}ms
				</span>
			)}
		</button>
	)
}
