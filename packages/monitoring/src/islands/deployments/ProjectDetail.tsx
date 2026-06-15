import { DeploymentHistoryTable } from '@/islands/deployments/DeploymentHistoryTable.tsx'
import { ProjectDetailHeader } from '@/islands/deployments/ProjectDetailHeader.tsx'

/**
 * The per-project detail view: the project header (stats + back link) above the
 * env-filtered history table. Both read the seeded selection; switching the env
 * tab or opening a row recomputes client-side with no reload. Mounted by
 * `Deployments` when a project is selected.
 */

export function ProjectDetail(): React.ReactElement {
	return (
		<div className="p-6">
			<ProjectDetailHeader />
			<DeploymentHistoryTable />
		</div>
	)
}
