import { DetailBadges } from '@/islands/logs/DetailBadges.tsx'
import { DetailContext } from '@/islands/logs/DetailContext.tsx'
import { LogIcon } from '@/islands/logs/LogIcon.tsx'
import { formatClock } from '@/lib/domain/monitoring/format.ts'

import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The scrollable body of the detail panel: message + clock, the badge row, the
 * request line, an error stack, the meta context grid, and the trace id. Each
 * block is conditional on its field, mirroring the original panel markup 1:1.
 */

const SMALL_ICON_SIZE = 12
const TRACE_PREFIX_LENGTH = 6

interface LogDetailBodyProps {
	readonly log: LogLine
}

export function LogDetailBody({ log }: LogDetailBodyProps): React.ReactElement {
	return (
		<div className="flex flex-col gap-4 p-4">
			<div>
				<div className="text-base-400 mb-1 flex justify-between text-[11px]">
					<span>Message</span>
					<span className="font-mono">
						{formatClock(Date.parse(log.time))}
					</span>
				</div>
				<div className="border-base-200 bg-base-50 text-base-800 rounded-lg border px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
					{log.message}
				</div>
			</div>

			<DetailBadges log={log} />

			{log.path !== null && (
				<div>
					<div className="text-base-400 mb-1 text-[11px]">
						Requête
					</div>
					<div className="bg-base-950 text-accent-200 rounded-lg px-3 py-2.5 font-mono text-xs">
						{log.method !== null && `${log.method} `}
						{log.path}
					</div>
				</div>
			)}

			{log.stack !== null && (
				<div>
					<div className="mb-1 flex items-center gap-1.5 text-[11px] text-red-600">
						<LogIcon name="flame" size={SMALL_ICON_SIZE} />
						Stack trace
					</div>
					<pre className="bg-base-950 overflow-auto rounded-lg p-3 font-mono text-[11.5px] leading-relaxed text-red-100">
						{log.stack}
					</pre>
				</div>
			)}

			<DetailContext meta={log.meta} />

			{log.traceId !== null && (
				<div className="text-base-500 flex items-center gap-1.5 font-mono text-[11px]">
					<LogIcon name="search" size={SMALL_ICON_SIZE} />
					trace {log.traceId.slice(0, TRACE_PREFIX_LENGTH)}
				</div>
			)}
		</div>
	)
}
