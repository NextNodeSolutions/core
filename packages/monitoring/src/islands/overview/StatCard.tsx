import { OverviewIcon } from '@/islands/overview/OverviewIcon.tsx'

import type { OverviewIconName } from '@/islands/overview/OverviewIcon.tsx'
import type { Tone } from '@/lib/domain/badge-status.ts'
import type { FleetStat } from '@/lib/domain/monitoring/fleet-overview.ts'

/**
 * One overview stat card. Visual parity with the former OverviewStatCard.astro,
 * plus a tone-driven surface: a `danger` stat gets a red wash + ring so a
 * critical number reads at a glance (the grid also widens it - see StatGrid).
 */

const VALUE_TONE: Record<Tone, string> = {
	neutral: 'text-base-900',
	positive: 'text-accent-800',
	warning: 'text-amber-600',
	danger: 'text-red-600',
}

const SURFACE_TONE: Record<Tone, string> = {
	neutral: 'border-base-200 bg-white',
	positive: 'border-base-200 bg-white',
	warning: 'border-amber-200 bg-amber-50',
	danger: 'border-red-200 bg-red-50',
}

const LABEL_TONE: Record<Tone, string> = {
	neutral: 'text-base-500',
	positive: 'text-base-500',
	warning: 'text-amber-600',
	danger: 'text-red-600',
}

interface StatCardProps {
	readonly icon: OverviewIconName
	readonly stat: FleetStat
	/** Grid placement (e.g. a `col-span-*` for an elevated/critical card). */
	readonly className?: string
}

export function StatCard({
	icon,
	stat,
	className = '',
}: StatCardProps): React.ReactElement {
	const { label, value, hint, tone } = stat
	return (
		<article
			className={`shadow-subtle hover:shadow-navy flex flex-col rounded-xl border px-4 py-4 transition-shadow ${SURFACE_TONE[tone]} ${className}`}
		>
			<div className={`mb-3 flex items-center gap-2 ${LABEL_TONE[tone]}`}>
				<OverviewIcon name={icon} size={16} />
				<span className="text-[12.5px] font-medium">{label}</span>
			</div>
			<p
				className={`font-mono text-[26px] font-bold tracking-[-0.02em] tabular-nums ${VALUE_TONE[tone]}`}
			>
				{value}
			</p>
			<p className="text-base-500 mt-2 text-xs">{hint}</p>
		</article>
	)
}
