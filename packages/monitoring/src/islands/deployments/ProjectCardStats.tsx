import {
	statusBadgeClass,
	statusLabel,
	stripBg,
	stripOpacity,
	successRateClass,
	successRateLabel,
} from '@/islands/deployments/deploy-styles.ts'

import type { ProjectSummary } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The middle stats row of a project card: the production status badge, the
 * success-rate figure, and the graded 5-status strip. Pure presentational -
 * split out of ProjectCard so each piece stays a single, small render. Markup
 * copied verbatim from DeploymentsContent.astro.
 */

interface ProjectCardStatsProps {
	readonly summary: ProjectSummary
	readonly currentDisplay: DeployDisplayStatus
}

export function ProjectCardStats({
	summary,
	currentDisplay,
}: ProjectCardStatsProps): React.ReactElement {
	const statusCount = summary.lastStatuses.length

	return (
		<div className="flex items-center gap-5 px-4.5 pt-3 pb-3.5">
			<div>
				<div className="text-base-400 text-[10.5px]">Production</div>
				<span
					className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusBadgeClass[currentDisplay]}`}
				>
					{statusLabel[currentDisplay]}
				</span>
			</div>
			<div>
				<div className="text-base-400 text-[10.5px]">Succès</div>
				<div
					className={`mt-1 font-mono text-sm font-bold ${successRateClass(summary.successRate)}`}
				>
					{successRateLabel(summary.successRate)}
				</div>
			</div>
			<div className="ml-auto text-right">
				<div className="text-base-400 text-[10.5px]">5 derniers</div>
				<div className="mt-1.5 flex gap-1">
					{summary.lastStatuses.map((status, index) => (
						<span
							key={`${status}-${String(index)}`}
							className={`h-[18px] w-[7px] rounded-[3px] ${stripBg[status]}`}
							style={{
								opacity: stripOpacity(index, statusCount),
							}}
						/>
					))}
				</div>
			</div>
		</div>
	)
}
