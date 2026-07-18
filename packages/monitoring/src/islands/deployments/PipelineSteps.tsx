import {
	stepDotClass,
	stepDotIcon,
	stepLabelClass,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { deploymentPipelineSteps } from '@/lib/domain/cloudflare/deployment-summary.ts'

import type { CloudflarePagesDeploymentStatus } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The drawer's pipeline timeline (Queued → … → Ready/Failed), derived purely
 * from the deployment status via `deploymentPipelineSteps`. Each step renders
 * its state-coloured dot (a glyph for done/active/failed, a small neutral dot
 * for pending). Markup + colour maps copied verbatim from the .astro drawer.
 */

interface PipelineStepsProps {
	readonly status: CloudflarePagesDeploymentStatus
}

export function PipelineSteps({
	status,
}: PipelineStepsProps): React.ReactElement {
	const steps = deploymentPipelineSteps(status)

	return (
		<div>
			<div className="text-base-400 mb-2 text-[11px]">Pipeline</div>
			<div className="flex flex-col">
				{steps.map(step => {
					const dotIcon = stepDotIcon[step.state]
					return (
						<div
							key={step.label}
							className="flex items-center gap-3 py-1.5"
						>
							<span
								className={`grid size-[18px] flex-none place-items-center rounded-full ${stepDotClass[step.state]}`}
							>
								{dotIcon === null ? (
									<span className="size-[5px] rounded-full bg-current" />
								) : (
									<DeployIcon name={dotIcon} size={11} />
								)}
							</span>
							<span
								className={`text-[13px] ${stepLabelClass[step.state]}`}
							>
								{step.label}
							</span>
						</div>
					)
				})}
			</div>
		</div>
	)
}
