import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import {
	statusBadgeClass,
	statusIcon,
	statusLabel,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'

/**
 * The detail-header title row: the status glyph, the project name + status
 * badge, the subdomain, and the "Visiter" external anchor. Pure presentational
 * - split out of ProjectDetailHeader to keep its render small. Markup copied
 * verbatim from DeploymentsContent.astro.
 */

interface ProjectDetailTitleProps {
	readonly project: CloudflarePagesProject
	readonly display: DeployDisplayStatus
}

export function ProjectDetailTitle({
	project,
	display,
}: ProjectDetailTitleProps): React.ReactElement {
	return (
		<div className="flex flex-wrap items-center gap-4 px-5 py-4">
			<div className="min-w-[220px] flex-1">
				<div className="flex flex-wrap items-center gap-2.5">
					<span className={DEPLOY_STATUS_COLOR[display]}>
						<DeployIcon name={statusIcon[display]} size={16} />
					</span>
					<span className="text-base-900 text-lg font-bold">
						{project.name}
					</span>
					<span
						className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusBadgeClass[display]}`}
					>
						{statusLabel[display]}
					</span>
				</div>
				<span className="text-accent-700 mt-1.5 inline-flex items-center gap-1.5 font-mono text-[13px]">
					{project.subdomain}
					<DeployIcon name="external" size={12} />
				</span>
			</div>
			<div className="flex flex-wrap gap-2">
				<a
					href={`https://${project.subdomain}`}
					target="_blank"
					rel="noreferrer"
					className="border-base-200 text-base-800 hover:bg-base-50 inline-flex items-center gap-1.5 rounded-full border bg-white px-3.5 py-1.5 text-xs font-medium"
				>
					<DeployIcon name="external" size={14} />
					Visiter
				</a>
			</div>
		</div>
	)
}
