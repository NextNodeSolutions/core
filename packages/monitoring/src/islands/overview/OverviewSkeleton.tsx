/**
 * Suspense fallback for the range-dependent region: a stat-card row + a log
 * panel placeholder of the SAME shape as the loaded content, so a range change
 * does not jump the layout - a subtle pulse, no spinner.
 */

const STAT_CARD_COUNT = 4
const STREAM_PREVIEW_ROWS = 5
const STAT_CELLS = Array.from({ length: STAT_CARD_COUNT }, (_, index) => index)
const STREAM_ROWS = Array.from(
	{ length: STREAM_PREVIEW_ROWS },
	(_, index) => index,
)

export function OverviewSkeleton(): React.ReactElement {
	return (
		<div className="flex animate-pulse flex-col gap-5" aria-hidden="true">
			<div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
				{STAT_CELLS.map(cell => (
					<div
						key={cell}
						className="border-base-200 shadow-subtle h-[116px] rounded-xl border bg-white"
					>
						<div className="bg-base-100 mt-4 ml-4 h-3 w-24 rounded" />
						<div className="bg-base-100 mt-4 ml-4 h-6 w-16 rounded" />
						<div className="bg-base-100 mt-4 ml-4 h-2.5 w-20 rounded" />
					</div>
				))}
			</div>
			<div className="border-base-200 shadow-subtle rounded-xl border bg-white">
				<div className="border-base-200 border-b px-4 py-3.5">
					<div className="bg-base-100 h-3.5 w-28 rounded" />
				</div>
				<div className="flex flex-col gap-2 px-4 py-3">
					{STREAM_ROWS.map(row => (
						<div
							key={row}
							className="bg-base-100 h-3 w-full rounded"
						/>
					))}
				</div>
			</div>
		</div>
	)
}
