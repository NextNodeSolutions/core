import { commitLabel } from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { ProjectSummary } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The footer strip of a project card: the latest commit + relative time on the
 * left, the prod / preview counts on the right. Pure presentational - split out
 * of ProjectCard to keep its render small. Markup copied verbatim from
 * DeploymentsContent.astro.
 */

interface ProjectCardFooterProps {
	readonly summary: ProjectSummary
	readonly nowMs: number
}

export function ProjectCardFooter({
	summary,
	nowMs,
}: ProjectCardFooterProps): React.ReactElement {
	return (
		<div className="border-base-100 bg-base-50 flex items-center justify-between border-t px-4.5 py-2.5">
			<span className="text-base-500 flex min-w-0 items-center gap-1.5 overflow-hidden font-mono text-[11.5px]">
				<DeployIcon name="branch" size={11} />
				<span className="truncate">
					{summary.last
						? `${commitLabel(summary.last)} · ${formatRelative(Date.parse(summary.last.createdAt), nowMs)}`
						: 'aucun déploiement'}
				</span>
			</span>
			<span className="text-base-500 flex flex-none gap-2.5 font-mono text-[11px]">
				<span>{summary.prodCount} prod</span>
				<span>{summary.previewCount} preview</span>
			</span>
		</div>
	)
}
