import type { OverviewNotice } from '@/lib/domain/monitoring/overview.ts'

/**
 * Degraded-upstream banners for the overview window. A failed source (VictoriaMetrics,
 * VictoriaLogs) surfaces here instead of silently showing zeroes - the same
 * "never a silent empty success" rule the API routes follow, ported to the
 * client so a range change that hits a degraded upstream still says so.
 */

interface OverviewNoticesProps {
	readonly notices: ReadonlyArray<OverviewNotice>
}

export function OverviewNotices({
	notices,
}: OverviewNoticesProps): React.ReactElement | null {
	if (!notices.length) return null
	return (
		<div className="flex flex-col gap-2.5">
			{notices.map(notice => (
				<div
					key={`${notice.section}-${notice.label}`}
					className="rounded-xl border border-red-200 bg-red-50 px-4 py-3"
				>
					<p className="text-sm font-semibold text-red-700">
						{notice.label}
					</p>
					<p className="font-mono text-[11px] text-red-600">
						{notice.message}
					</p>
				</div>
			))}
		</div>
	)
}
