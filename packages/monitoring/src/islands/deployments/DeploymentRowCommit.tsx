import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { deploymentCommitLabel } from '@/lib/domain/cloudflare/deployment-summary.ts'
import { EMPTY_LABEL } from '@/lib/domain/monitoring/format.ts'

import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The two text-heavy cells of a history row - the commit message + author, and
 * the branch + short hash. Split out of DeploymentRow to keep the row small;
 * returns the `<td>` pair consumed in exactly one spot. Markup copied verbatim
 * from DeploymentsContent.astro.
 */

interface DeploymentRowCommitProps {
	readonly deployment: CloudflarePagesDeployment
}

export function DeploymentRowCommit({
	deployment,
}: DeploymentRowCommitProps): React.ReactElement {
	return (
		<>
			<td className="px-2 py-2.5">
				<div className="text-base-900 max-w-[300px] truncate font-medium">
					{deployment.commitMessage ?? deployment.shortId}
				</div>
				<div className="text-base-500 font-mono text-[11px]">
					{deployment.shortId} · {deployment.author ?? 'inconnu'}
				</div>
			</td>
			<td className="px-2 py-2.5">
				<span className="text-base-700 inline-flex items-center gap-1.5 font-mono text-[12.5px]">
					<DeployIcon name="branch" size={11} />
					{deployment.branch ?? EMPTY_LABEL}
				</span>
				<div className="text-base-500 font-mono text-[11px]">
					{deploymentCommitLabel(deployment)}
				</div>
			</td>
		</>
	)
}
