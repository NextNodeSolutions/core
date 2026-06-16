import { statusBadgeClass } from '@/islands/logs/level-styles.ts'
import { LogIcon } from '@/islands/logs/LogIcon.tsx'

import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The chip row under the detail message: service, vps, HTTP method and status.
 * Each chip is conditional on its field being present, matching the original
 * panel exactly.
 */

const VPS_ICON_SIZE = 11

interface DetailBadgesProps {
	readonly log: LogLine
}

export function DetailBadges({ log }: DetailBadgesProps): React.ReactElement {
	return (
		<div className="flex flex-wrap gap-2">
			{log.service !== null && (
				<span className="border-base-200 bg-base-100 text-base-700 inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
					{log.service}
				</span>
			)}
			{log.vps !== null && (
				<span className="border-base-200 bg-base-100 text-base-700 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
					<LogIcon name="server" size={VPS_ICON_SIZE} />
					{log.vps}
				</span>
			)}
			{log.method !== null && (
				<span className="border-accent-200 bg-accent-50 text-accent-700 inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
					{log.method}
				</span>
			)}
			{log.status !== null && (
				<span
					className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${statusBadgeClass(log.status)}`}
				>
					{log.status}
				</span>
			)}
		</div>
	)
}
