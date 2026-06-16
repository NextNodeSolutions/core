import { useAtomValue, useSetAtom } from 'jotai'

import {
	detailSummaryAtom,
	nowMsAtom,
	selectedProjectAtom,
} from '@/islands/deployments/atoms.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { ProjectDetailTitle } from '@/islands/deployments/ProjectDetailTitle.tsx'
import { ProjectStatsGrid } from '@/islands/deployments/ProjectStatsGrid.tsx'
import { clearProjectAtom } from '@/islands/deployments/select-actions.ts'
import { deploymentDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The selected project's header: the "Tous les projets" back link (clears the
 * selection, no navigation) above the title block (ProjectDetailTitle) and the
 * stats grid (ProjectStatsGrid). Renders nothing on the master view. Markup
 * copied verbatim from DeploymentsContent.astro.
 */

export function ProjectDetailHeader(): React.ReactElement | null {
	const project = useAtomValue(selectedProjectAtom)
	const summary = useAtomValue(detailSummaryAtom)
	const nowMs = useAtomValue(nowMsAtom)
	const clearProject = useSetAtom(clearProjectAtom)

	if (project === null) return null

	const display = deploymentDisplayStatus(
		summary?.current?.status ?? 'unknown',
	)

	return (
		<>
			<button
				type="button"
				onClick={() => clearProject()}
				className="text-base-700 hover:bg-base-100 mb-3.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
			>
				<span className="rotate-180">
					<DeployIcon name="chevron" size={14} />
				</span>
				Tous les projets
			</button>

			<div className="border-base-200 shadow-subtle mb-4 overflow-hidden rounded-xl border bg-white">
				<ProjectDetailTitle project={project} display={display} />
				<ProjectStatsGrid
					project={project}
					summary={summary}
					nowMs={nowMs}
				/>
			</div>
		</>
	)
}
