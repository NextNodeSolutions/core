import { useAtom } from 'jotai'

import { rangeAtom } from '@/islands/overview/atoms.ts'

/**
 * Client segmented control for the overview time-window. Replaces the server
 * RangeControl ON THIS PAGE: selecting a range sets `rangeAtom` (which triggers
 * the per-range `/api/overview` fetch behind the data region's Suspense)
 * instead of navigating. Visual style matches RangeControl.astro 1:1.
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
						onClick={() => setRange(candidate)}
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
