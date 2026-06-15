import type { TailStatus } from '@/islands/deployments/use-deployment-tail.ts'

/**
 * The tail panel's header: a tone-coloured status dot + label and the
 * start / stop / clear buttons. Pure presentational - the handlers come from
 * the parent's `useDeploymentTail`. Styling matches DeploymentTail.astro.
 */

const TONE_DOT_CLASS: Record<TailStatus, string> = {
	idle: 'bg-base-300',
	connecting: 'bg-base-300',
	live: 'bg-accent-500 animate-pulse',
	stopped: 'bg-base-300',
	error: 'bg-red-500',
}

const TONE_LABEL: Record<TailStatus, string> = {
	idle: 'Idle',
	connecting: 'Connecting…',
	live: 'Live',
	stopped: 'Stopped',
	error: 'Error',
}

interface TailControlsProps {
	readonly status: TailStatus
	readonly onStart: () => void
	readonly onStop: () => void
	readonly onClear: () => void
}

export function TailControls({
	status,
	onStart,
	onStop,
	onClear,
}: TailControlsProps): React.ReactElement {
	return (
		<header className="border-base-100 flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
			<span className="text-base-500 inline-flex items-center gap-2 font-mono text-[10px] tracking-wider uppercase">
				<span
					aria-hidden="true"
					className={`inline-block size-1.5 rounded-full ${TONE_DOT_CLASS[status]}`}
				/>
				<span>{TONE_LABEL[status]}</span>
			</span>
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={onStart}
					className="bg-accent-600 hover:bg-accent-700 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
				>
					Start tail
				</button>
				<button
					type="button"
					onClick={onStop}
					className="bg-base-50 hover:bg-base-100 text-base-800 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium"
				>
					Stop
				</button>
				<button
					type="button"
					onClick={onClear}
					className="text-base-600 hover:bg-base-100 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium"
				>
					Clear
				</button>
			</div>
		</header>
	)
}
