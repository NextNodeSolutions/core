/**
 * Suspense fallback for the data region while a range's logs load. Mirrors the
 * region's shape - a histogram strip then a few list rows - so the controls
 * above it do not jump when the real content swaps in. Only the data region
 * suspends; the filter controls stay mounted and interactive.
 */

const SKELETON_ROW_COUNT = 8
const ROWS = Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => index)
const HISTOGRAM_HEIGHT = 56

interface LogsSkeletonProps {
	readonly range: string
}

export function LogsSkeleton({ range }: LogsSkeletonProps): React.ReactElement {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			role="status"
			aria-label="Chargement des logs"
		>
			<div className="border-base-200 flex-none border-b px-6 pt-3 pb-1">
				<div className="mb-1.5 flex items-center justify-between">
					<span className="text-base-500 font-mono text-[10.5px] font-semibold tracking-[0.06em] uppercase">
						Volume · {range}
					</span>
				</div>
				<div
					className="bg-base-100 animate-pulse rounded"
					style={{ height: HISTOGRAM_HEIGHT }}
				/>
			</div>
			<div className="animate-pulse space-y-2 px-3.5 py-3">
				{ROWS.map(row => (
					<div
						key={row}
						className="bg-base-100 h-3 w-full rounded-full"
					/>
				))}
			</div>
		</div>
	)
}
