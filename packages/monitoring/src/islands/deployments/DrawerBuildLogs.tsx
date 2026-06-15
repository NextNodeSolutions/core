import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { DeploymentTail } from '@/islands/deployments/DeploymentTail.tsx'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The drawer's "Build logs" block. For a `building` deployment it mounts the
 * live SSE tail (keyed by deployment id so switching selection remounts it and
 * closes the prior stream); otherwise it shows the static "live during build
 * only" message - the exact behaviour of the former server panel. Markup copied
 * verbatim from DeploymentsContent.astro.
 */

interface DrawerBuildLogsProps {
	readonly projectName: string
	readonly deploymentId: string
	readonly display: DeployDisplayStatus
}

export function DrawerBuildLogs({
	projectName,
	deploymentId,
	display,
}: DrawerBuildLogsProps): React.ReactElement {
	return (
		<div>
			<div className="text-base-400 mb-2 flex items-center gap-1.5 text-[11px]">
				<DeployIcon name="logs" size={12} />
				Build logs
			</div>
			{display === 'building' ? (
				<DeploymentTail
					key={deploymentId}
					projectName={projectName}
					deploymentId={deploymentId}
				/>
			) : (
				<div className="border-base-200 bg-base-50 text-base-500 rounded-lg border px-3 py-2.5 text-xs">
					Build logs disponibles en direct pendant le build
					uniquement.
				</div>
			)}
		</div>
	)
}
