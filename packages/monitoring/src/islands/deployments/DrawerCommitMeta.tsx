import { ENV_PILL_CLASS } from '@/components/deployments/activity-display.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { deploymentCommitLabel } from '@/lib/domain/cloudflare/deployment-summary.ts'
import { EMPTY_LABEL } from '@/lib/domain/monitoring/format.ts'

import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The drawer's commit headline + the environment / branch / hash chips. Pure
 * presentational - split out of DeploymentDrawer to keep its render small.
 * Markup copied verbatim from DeploymentsContent.astro.
 */

interface DrawerCommitMetaProps {
	readonly deployment: CloudflarePagesDeployment
}

export function DrawerCommitMeta({
	deployment,
}: DrawerCommitMetaProps): React.ReactElement {
	return (
		<div>
			<div className="text-base-900 mb-2 text-[15px] font-semibold">
				{deployment.commitMessage ?? deployment.shortId}
			</div>
			<div className="flex flex-wrap gap-2">
				<span
					className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${ENV_PILL_CLASS[deployment.environment]}`}
				>
					{deployment.environment}
				</span>
				<span className="border-base-200 bg-base-100 text-base-700 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
					<DeployIcon name="branch" size={11} />
					{deployment.branch ?? EMPTY_LABEL}
				</span>
				<span className="border-base-200 bg-base-100 text-base-700 inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px]">
					{deploymentCommitLabel(deployment)}
				</span>
			</div>
		</div>
	)
}
