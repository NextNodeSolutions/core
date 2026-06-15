import { useAtom } from 'jotai'

import { metricAtom } from '@/islands/fleet-cmp/atoms.ts'
import { CMP_METRIC_OPTIONS } from '@/islands/fleet-cmp/metrics.ts'

/**
 * Client segmented control for the compared metric. Replaces the server `<a
 * href>` tabs: clicking a tab sets `metricAtom` (which selects that metric's
 * cached/fetched lines) instead of navigating, so there is no page reload and
 * no scroll jump. Stays mounted and interactive while a cold metric loads.
 * Visual style matches the former tabs 1:1.
 */

export function MetricTabs(): React.ReactElement {
	const [metric, setMetric] = useAtom(metricAtom)

	return (
		<div
			className="border-base-200 bg-base-100 inline-flex gap-0.5 rounded-full border p-0.5"
			role="tablist"
			aria-label="Métrique comparée"
		>
			{CMP_METRIC_OPTIONS.map(option => {
				const active = option.key === metric
				return (
					<button
						type="button"
						key={option.key}
						role="tab"
						aria-selected={active}
						onClick={() => setMetric(option.key)}
						className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
							active
								? 'text-base-900 shadow-subtle bg-white'
								: 'text-base-600 hover:text-base-900'
						}`}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
