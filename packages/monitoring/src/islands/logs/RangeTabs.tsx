import { useAtom, useSetAtom } from 'jotai'

import { rangeAtom, selAtom } from '@/islands/logs/atoms.ts'

/**
 * Client segmented control for the log time-range. Replaces the server
 * RangeControl ON THIS PAGE: switching a range sets `rangeAtom` (which triggers
 * the per-range fetch) instead of navigating. Visual style matches
 * RangeControl.astro 1:1. Selection is range-scoped, so a range change clears
 * the open detail panel.
 */

const RANGES = ['live', '1h', '6h', '24h'] as const

const LABELS: Record<(typeof RANGES)[number], string> = {
	live: 'Live',
	'1h': '1h',
	'6h': '6h',
	'24h': '24h',
}

export function RangeTabs(): React.ReactElement {
	const [range, setRange] = useAtom(rangeAtom)
	const setSel = useSetAtom(selAtom)

	const selectRange = (next: string): void => {
		setRange(next)
		setSel(null)
	}

	return (
		<div
			className="border-base-200 bg-base-100 inline-flex gap-0.5 rounded-full border p-0.5"
			role="tablist"
			aria-label="Plage temporelle"
		>
			{RANGES.map(candidate => {
				const active = candidate === range
				return (
					<button
						type="button"
						key={candidate}
						role="tab"
						aria-selected={active}
						onClick={() => selectRange(candidate)}
						className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
							active
								? 'text-base-900 shadow-subtle bg-white'
								: 'text-base-600 hover:text-base-900'
						}`}
					>
						{candidate === 'live' && (
							<span
								className={`inline-block size-1.5 rounded-full ${
									active ? 'bg-accent-600' : 'bg-base-400'
								}`}
							/>
						)}
						{LABELS[candidate]}
					</button>
				)
			})}
		</div>
	)
}
