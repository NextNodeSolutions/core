import { useAtomValue } from 'jotai'

import { nowMsAtom, selectedEntryAtom } from '@/islands/deployments/atoms.ts'
import { DrawerActions } from '@/islands/deployments/DrawerActions.tsx'
import { DrawerBuildLogs } from '@/islands/deployments/DrawerBuildLogs.tsx'
import { DrawerCommitMeta } from '@/islands/deployments/DrawerCommitMeta.tsx'
import { DrawerHeader } from '@/islands/deployments/DrawerHeader.tsx'
import { DrawerSpecs } from '@/islands/deployments/DrawerSpecs.tsx'
import { PipelineSteps } from '@/islands/deployments/PipelineSteps.tsx'
import { deploymentDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The right-side detail drawer for the open deployment. Reads the resolved
 * selection from state and composes the header (close = clears selection, no
 * navigation), the commit meta, the specs grid, the URL, the pipeline, the
 * live build-log tail (only while `building`) and the action row. Renders
 * nothing when no deployment is selected.
 */

export function DeploymentDrawer(): React.ReactElement | null {
	const entry = useAtomValue(selectedEntryAtom)
	const nowMs = useAtomValue(nowMsAtom)

	if (entry === null) return null

	const { projectName, deployment } = entry
	const display = deploymentDisplayStatus(deployment.status)

	return (
		<div className="border-base-200 flex w-[440px] flex-none flex-col overflow-auto border-l bg-white">
			<DrawerHeader shortId={deployment.shortId} display={display} />

			<div className="flex flex-col gap-4 p-4.5">
				<DrawerCommitMeta deployment={deployment} />

				<DrawerSpecs
					projectName={projectName}
					deployment={deployment}
					nowMs={nowMs}
				/>

				{deployment.url !== null && (
					<div>
						<div className="text-base-400 mb-1 text-[11px]">
							URL
						</div>
						<a
							href={`https://${deployment.url}`}
							target="_blank"
							rel="noreferrer"
							className="text-accent-700 font-mono text-[12.5px] break-all hover:underline"
						>
							{deployment.url}
						</a>
					</div>
				)}

				<PipelineSteps status={deployment.status} />

				<DrawerBuildLogs
					projectName={projectName}
					deploymentId={deployment.id}
					display={display}
				/>

				<DrawerActions
					projectName={projectName}
					deployment={deployment}
					display={display}
				/>
			</div>
		</div>
	)
}
