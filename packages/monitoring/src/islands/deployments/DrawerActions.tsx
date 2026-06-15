import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { MutationForm } from '@/islands/deployments/MutationForm.tsx'
import { cloudflareApiPath } from '@/lib/domain/cloudflare/pages-routes.ts'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The drawer's action row. Re-deploy (on an errored deploy) and Rollback (on a
 * ready prod deploy) are native POST `MutationForm`s to the existing API paths
 * - rare, genuine mutations a normal server round-trip handles. "Visiter" stays
 * a normal external anchor. Markup copied verbatim from DeploymentsContent.astro.
 */

interface DrawerActionsProps {
	readonly projectName: string
	readonly deployment: CloudflarePagesDeployment
	readonly display: DeployDisplayStatus
}

export function DrawerActions({
	projectName,
	deployment,
	display,
}: DrawerActionsProps): React.ReactElement {
	const isProd = deployment.environment === 'production'
	const actionFor = (verb: string): string =>
		cloudflareApiPath(projectName, 'deployments', deployment.id, verb)

	return (
		<div className="flex gap-2">
			{display === 'error' && (
				<MutationForm
					action={actionFor('retry')}
					label="Re-deploy"
					buttonClassName="bg-accent-600 hover:bg-accent-700 text-white"
				/>
			)}
			{display === 'ready' && isProd && (
				<MutationForm
					action={actionFor('rollback')}
					label="Rollback"
					buttonClassName="bg-base-50 hover:bg-base-100 text-base-800"
				/>
			)}
			{deployment.url !== null && (
				<a
					href={`https://${deployment.url}`}
					target="_blank"
					rel="noreferrer"
					className="border-base-200 text-base-800 hover:bg-base-50 inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border bg-white px-3.5 py-1.5 text-xs font-medium"
				>
					<DeployIcon name="external" size={14} />
					Visiter
				</a>
			)}
		</div>
	)
}
