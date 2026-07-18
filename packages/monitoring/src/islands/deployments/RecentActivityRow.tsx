import { useSetAtom } from 'jotai'

import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import {
	commitLabel,
	envPillClass,
	statusIcon,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { openRecentDeploymentAtom } from '@/islands/deployments/select-actions.ts'
import { deploymentDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import { formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { RecentDeployment } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * One row of the recent-activity list. Clicking it opens the deployment's
 * drawer AND selects its project in one transition (`openRecentDeploymentAtom`)
 * - the former `linkTo({ project, sel })` anchor, now pure state. Styling
 * matches the .astro row verbatim.
 */

interface RecentActivityRowProps {
	readonly entry: RecentDeployment
	readonly nowMs: number
}

export function RecentActivityRow({
	entry,
	nowMs,
}: RecentActivityRowProps): React.ReactElement {
	const openDeployment = useSetAtom(openRecentDeploymentAtom)
	const display = deploymentDisplayStatus(entry.deployment.status)
	const isProd = entry.deployment.environment === 'production'

	return (
		<button
			type="button"
			onClick={() =>
				openDeployment({
					projectName: entry.projectName,
					deploymentId: entry.deployment.id,
				})
			}
			className="border-base-100 hover:bg-base-50 flex w-full items-center gap-3.5 border-b px-4 py-2.5 text-left last:border-b-0"
		>
			<span className={`flex-none ${DEPLOY_STATUS_COLOR[display]}`}>
				<DeployIcon name={statusIcon[display]} size={15} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-base-900 truncate text-[13.5px] font-medium">
					{entry.deployment.commitMessage ?? entry.deployment.shortId}
				</div>
				<div className="text-base-500 font-mono text-[11px]">
					{commitLabel(entry.deployment)}
				</div>
			</div>
			<span className="border-base-200 bg-base-100 text-base-700 flex-none rounded-full border px-2 py-0.5 font-mono text-[11px]">
				{entry.projectName}
			</span>
			<span className="border-base-200 bg-base-50 text-base-500 flex-none rounded-full border px-2 py-0.5 font-mono text-[11px]">
				pages
			</span>
			<span
				className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-medium ${envPillClass(entry.deployment.environment)}`}
			>
				{isProd ? 'prod' : 'preview'}
			</span>
			<span className="text-base-500 flex-none font-mono text-xs whitespace-nowrap">
				{formatRelative(Date.parse(entry.deployment.createdAt), nowMs)}
			</span>
		</button>
	)
}
