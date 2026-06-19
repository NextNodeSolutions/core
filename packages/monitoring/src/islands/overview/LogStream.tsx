import type { LogLevel } from '@/lib/domain/monitoring/log-query.ts'
import type { OverviewStreamLine } from '@/lib/domain/monitoring/overview.ts'

/**
 * The overview's recent-log preview panel (the window's newest lines). A peek
 * at the fleet stream for the selected range; the full explorer lives at /logs.
 * Visual parity with the former "Flux de logs" panel in OverviewContent.astro.
 */

const LEVEL_CLASS: Record<LogLevel, string> = {
	debug: 'text-base-400',
	info: 'text-sky-600',
	warn: 'text-amber-600',
	error: 'text-red-600',
}

interface LogStreamProps {
	readonly stream: ReadonlyArray<OverviewStreamLine>
}

export function LogStream({ stream }: LogStreamProps): React.ReactElement {
	return (
		<div className="border-base-200 shadow-subtle flex min-w-0 flex-col rounded-xl border bg-white">
			<header className="border-base-200 flex items-center justify-between border-b px-4 py-3.5">
				<span className="text-base-900 text-sm font-semibold">
					Flux de logs
				</span>
				<a
					href="/logs"
					className="text-base-700 hover:bg-base-50 rounded-full px-3 py-1 text-xs font-medium"
				>
					Explorer
				</a>
			</header>
			{stream.length > 0 ? (
				<div className="flex flex-col py-2 font-mono text-[11.5px]">
					{stream.map(line => (
						<a
							key={line.key}
							href="/logs"
							className="hover:bg-base-50 flex gap-2 overflow-hidden rounded px-3 py-1 whitespace-nowrap"
						>
							<span className="text-base-400">{line.time}</span>
							<span
								className={`w-10 shrink-0 text-[10.5px] font-semibold uppercase ${
									line.level === null
										? 'text-base-400'
										: LEVEL_CLASS[line.level]
								}`}
							>
								{line.level ?? '·'}
							</span>
							<span className="text-base-500 shrink-0">
								{line.service ?? ''}
							</span>
							<span className="text-base-800 overflow-hidden text-ellipsis">
								{line.message}
							</span>
						</a>
					))}
				</div>
			) : (
				<p className="text-base-500 px-4 py-6 text-center text-xs">
					Aucun log sur la fenêtre sélectionnée.
				</p>
			)}
		</div>
	)
}
