import { successRateLabel } from '@/islands/deployments/deploy-styles.ts'
import { deploymentCommitLabel } from '@/lib/domain/cloudflare/deployment-summary.ts'
import { EMPTY_LABEL, formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { ProjectSummary } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'

/**
 * The detail-header stats grid: prod commit, prod branch, last-deploy time,
 * success rate, and the prod/preview counts. Pure presentational - split out of
 * ProjectDetailHeader to keep each render small. Markup copied verbatim from
 * DeploymentsContent.astro.
 */

interface ProjectStatsGridProps {
	readonly project: CloudflarePagesProject
	readonly summary: ProjectSummary | null
	readonly nowMs: number
}

export function ProjectStatsGrid({
	project,
	summary,
	nowMs,
}: ProjectStatsGridProps): React.ReactElement {
	const current = summary?.current ?? null

	return (
		<div className="border-base-100 bg-base-50 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-4 border-t px-5 py-3.5">
			<div>
				<div className="text-base-400 text-[11px]">
					Déploiement prod
				</div>
				<div className="text-base-900 mt-0.5 font-mono text-[13px]">
					{current ? deploymentCommitLabel(current) : EMPTY_LABEL}
				</div>
			</div>
			<div>
				<div className="text-base-400 text-[11px]">Branche prod</div>
				<div className="text-base-900 mt-0.5 font-mono text-[13px]">
					{project.productionBranch}
				</div>
			</div>
			<div>
				<div className="text-base-400 text-[11px]">Dernier deploy</div>
				<div className="text-base-900 mt-0.5 text-[13px]">
					{current
						? formatRelative(Date.parse(current.createdAt), nowMs)
						: EMPTY_LABEL}
				</div>
			</div>
			<div>
				<div className="text-base-400 text-[11px]">Taux de succès</div>
				<div className="text-base-900 mt-0.5 font-mono text-[13px]">
					{successRateLabel(summary?.successRate ?? null)}
				</div>
			</div>
			<div>
				<div className="text-base-400 text-[11px]">Déploiements</div>
				<div className="text-base-900 mt-0.5 text-[13px]">
					{summary?.prodCount ?? 0} prod ·{' '}
					{summary?.previewCount ?? 0} preview
				</div>
			</div>
		</div>
	)
}
