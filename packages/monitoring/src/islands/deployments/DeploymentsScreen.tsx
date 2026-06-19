import { useAtomValue } from 'jotai'

import { selectedProjectAtom } from '@/islands/deployments/atoms.ts'
import { DeploymentDrawer } from '@/islands/deployments/DeploymentDrawer.tsx'
import { ProjectDetail } from '@/islands/deployments/ProjectDetail.tsx'
import { ProjectGrid } from '@/islands/deployments/ProjectGrid.tsx'

/**
 * The screen body, mounted inside the island's seeded store. It shows the
 * all-projects master grid or the per-project detail view depending on whether
 * a project is selected, and renders the detail drawer alongside whenever a
 * deployment is open. No Suspense: every value is seeded client-side and there
 * is no per-interaction fetch, so nothing can suspend.
 */

export function DeploymentsScreen(): React.ReactElement {
	const selectedProject = useAtomValue(selectedProjectAtom)

	return (
		<div className="flex">
			<div className="min-w-0 flex-1">
				{selectedProject === null ? <ProjectGrid /> : <ProjectDetail />}
			</div>
			<DeploymentDrawer />
		</div>
	)
}
