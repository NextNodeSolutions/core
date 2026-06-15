import { useSetAtom } from 'jotai'

import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import { statusIcon } from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { ProjectCardFooter } from '@/islands/deployments/ProjectCardFooter.tsx'
import { ProjectCardStats } from '@/islands/deployments/ProjectCardStats.tsx'
import { selectProjectAtom } from '@/islands/deployments/select-actions.ts'

import type { ProjectView } from '@/islands/deployments/atoms.ts'

/**
 * One project card in the master grid. Clicking it selects the project (and
 * clears any env filter / open drawer) via `selectProjectAtom` instead of
 * navigating - no reload, no scroll jump. The former server `<a href>` becomes
 * a `<button>`; the stats row + footer live in their own components. All
 * classes are copied verbatim from DeploymentsContent.astro.
 */

interface ProjectCardProps {
	readonly view: ProjectView
	readonly nowMs: number
}

export function ProjectCard({
	view,
	nowMs,
}: ProjectCardProps): React.ReactElement {
	const selectProject = useSetAtom(selectProjectAtom)
	const { project, summary, currentDisplay } = view

	return (
		<button
			type="button"
			onClick={() => selectProject(project.name)}
			className="border-base-200 shadow-subtle flex flex-col overflow-hidden rounded-xl border bg-white text-left transition-shadow hover:shadow-md"
		>
			<div className="flex items-start justify-between gap-2.5 px-4.5 pt-4">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className={DEPLOY_STATUS_COLOR[currentDisplay]}>
							<DeployIcon
								name={statusIcon[currentDisplay]}
								size={15}
							/>
						</span>
						<span className="text-base-900 text-[15px] font-semibold">
							{project.name}
						</span>
					</div>
					<span className="text-base-400 mt-1 inline-flex items-center gap-1 font-mono text-xs">
						{project.subdomain}
						<DeployIcon name="external" size={11} />
					</span>
				</div>
			</div>

			<ProjectCardStats
				summary={summary}
				currentDisplay={currentDisplay}
			/>
			<ProjectCardFooter summary={summary} nowMs={nowMs} />
		</button>
	)
}
