import { useSetAtom } from 'jotai'

import { ActivityRowCells } from '@/islands/deployments/ActivityRowCells.tsx'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { openRecentDeploymentAtom } from '@/islands/deployments/select-actions.ts'

import type { ActivityRowView } from '@/lib/domain/deployments/activity-view.ts'

/**
 * ONE row of the recent-activity list, whatever the source: everything shown
 * comes from the shared `ActivityRowView` (built once in domain), so this
 * component replaces the former per-source RecentActivityRow / VpsActivityRow
 * pair. Only the row's SHELL branches, and it branches on the semantic
 * `target.kind`, not on the source: an external target is a plain link (the
 * detail lives off-app), a deployment target opens the drawer + selects the
 * project in one atom write (`openRecentDeploymentAtom` - no navigation).
 */

const ROW_CLASS =
	'border-base-100 hover:bg-base-50 flex w-full items-center gap-3.5 border-b px-4 py-2.5 text-left last:border-b-0'

interface ActivityRowProps {
	readonly view: ActivityRowView
	readonly nowMs: number
}

export function ActivityRow({
	view,
	nowMs,
}: ActivityRowProps): React.ReactElement {
	const openDeployment = useSetAtom(openRecentDeploymentAtom)

	if (view.target.kind === 'external') {
		return (
			<a
				href={view.target.href}
				target="_blank"
				rel="noreferrer"
				className={ROW_CLASS}
			>
				<ActivityRowCells view={view} nowMs={nowMs} />
				<span className="text-base-400 flex-none">
					<DeployIcon name="external" size={13} />
				</span>
			</a>
		)
	}
	const { projectName, deploymentId } = view.target
	return (
		<button
			type="button"
			onClick={() => openDeployment({ projectName, deploymentId })}
			className={ROW_CLASS}
		>
			<ActivityRowCells view={view} nowMs={nowMs} />
		</button>
	)
}
