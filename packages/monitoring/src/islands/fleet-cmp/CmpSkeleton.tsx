/**
 * Suspense fallback for the comparison chart region while a cold metric loads.
 * Holds the chart's height so the card does not collapse and the tabs above do
 * not jump - a subtle pulsing placeholder, no spinner.
 */

const CHART_HEIGHT = 220

export function CmpSkeleton(): React.ReactElement {
	return (
		<div className="px-2.5 pt-3 pb-4" aria-hidden="true">
			<div
				className="bg-base-100 animate-pulse rounded-lg"
				style={{ height: CHART_HEIGHT }}
			/>
		</div>
	)
}
