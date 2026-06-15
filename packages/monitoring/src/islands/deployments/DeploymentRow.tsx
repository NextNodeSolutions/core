import { useAtomValue, useSetAtom } from 'jotai'

import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import {
	isSelectedFamily,
	nowMsAtom,
	selAtom,
} from '@/islands/deployments/atoms.ts'
import {
	durationLabel,
	envPillClass,
	statusIcon,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { DeploymentRowCommit } from '@/islands/deployments/DeploymentRowCommit.tsx'
import { deploymentDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import { formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * One row of the history table. Clicking it opens the deployment drawer (sets
 * `selAtom`) - no navigation. The row reads only its own selection boolean from
 * `isSelectedFamily`, so opening the drawer re-renders just this row, not the
 * whole table. Styling mirrors the original anchor row, including the active
 * `bg-base-50` tint.
 */

interface DeploymentRowProps {
	readonly deployment: CloudflarePagesDeployment
}

export function DeploymentRow({
	deployment,
}: DeploymentRowProps): React.ReactElement {
	const active = useAtomValue(isSelectedFamily(deployment.id))
	const nowMs = useAtomValue(nowMsAtom)
	const setSel = useSetAtom(selAtom)
	const display = deploymentDisplayStatus(deployment.status)
	const isProd = deployment.environment === 'production'

	return (
		<tr
			onClick={() => setSel(deployment.id)}
			className={`border-base-100 cursor-pointer border-b last:border-b-0 ${
				active ? 'bg-base-50' : 'hover:bg-base-50'
			}`}
		>
			<td className="px-4 py-2.5">
				<span className={`block ${DEPLOY_STATUS_COLOR[display]}`}>
					<DeployIcon name={statusIcon[display]} size={15} />
				</span>
			</td>
			<DeploymentRowCommit deployment={deployment} />
			<td className="px-2 py-2.5">
				<span
					className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${envPillClass(deployment.environment)}`}
				>
					{isProd ? 'prod' : 'preview'}
				</span>
			</td>
			<td className="text-base-500 px-2 py-2.5 font-mono text-[12.5px]">
				{durationLabel(deployment)}
			</td>
			<td className="text-base-500 px-4 py-2.5 text-right font-mono text-xs whitespace-nowrap">
				{formatRelative(Date.parse(deployment.createdAt), nowMs)}
			</td>
		</tr>
	)
}
