import { useAtomValue } from 'jotai'

import {
	nowMsAtom,
	projectCountAtom,
	projectViewsAtom,
} from '@/islands/deployments/atoms.ts'
import { ProjectCard } from '@/islands/deployments/ProjectCard.tsx'
import { RecentActivity } from '@/islands/deployments/RecentActivity.tsx'

/**
 * The all-projects master view: the Cloudflare Pages header, the card grid, and
 * the recent-activity list below it. Pure read of the seeded derivations - no
 * fetch. Cards drive the selection; the layout + kicker copy match
 * DeploymentsContent.astro verbatim.
 */

export function ProjectGrid(): React.ReactElement {
	const projectViews = useAtomValue(projectViewsAtom)
	const projectCount = useAtomValue(projectCountAtom)
	const nowMs = useAtomValue(nowMsAtom)

	return (
		<div>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
				<span className="text-base-700 inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">
					<span className="bg-base-900 size-2.5 rounded-[2px]" />
					Cloudflare Pages · {projectCount} projets
				</span>
				<span className="text-base-500 text-xs">
					Sélectionnez un projet pour voir ses déploiements
				</span>
			</div>

			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
				{projectViews.map(view => (
					<ProjectCard
						key={view.project.name}
						view={view}
						nowMs={nowMs}
					/>
				))}
			</div>

			<div className="mt-6 mb-3">
				<span className="text-base-700 inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">
					<span className="bg-base-900 size-2.5 rounded-[2px]" />
					Activité récente · tous projets
				</span>
			</div>
			<RecentActivity />
		</div>
	)
}
