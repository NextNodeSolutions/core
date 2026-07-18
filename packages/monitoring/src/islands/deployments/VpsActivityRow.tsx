import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import {
	envPillClass,
	statusIcon,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import {
	vpsRunDisplayStatus,
	vpsRunShortSha,
} from '@/lib/domain/github/vps-deploy-run.ts'
import { formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

/**
 * One VPS deploy run in the recent-activity list. Unlike a Pages row there is
 * no local drawer to open - the run's detail lives on GitHub, so the row is a
 * plain external link. Layout mirrors RecentActivityRow so both sources read
 * as one continuous feed.
 */

interface VpsActivityRowProps {
	readonly run: VpsDeployRun
	readonly nowMs: number
}

export function VpsActivityRow({
	run,
	nowMs,
}: VpsActivityRowProps): React.ReactElement {
	const display = vpsRunDisplayStatus(run)
	const isProd = run.environment === 'production'

	return (
		<a
			href={run.htmlUrl}
			target="_blank"
			rel="noreferrer"
			className="border-base-100 hover:bg-base-50 flex w-full items-center gap-3.5 border-b px-4 py-2.5 text-left last:border-b-0"
		>
			<span className={`flex-none ${DEPLOY_STATUS_COLOR[display]}`}>
				<DeployIcon name={statusIcon[display]} size={15} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-base-900 truncate text-[13.5px] font-medium">
					{run.title || run.workflowName}
				</div>
				<div className="text-base-500 font-mono text-[11px]">
					{run.branch ?? '-'} · {vpsRunShortSha(run)}
				</div>
			</div>
			<span className="border-base-200 bg-base-100 text-base-700 flex-none rounded-full border px-2 py-0.5 font-mono text-[11px]">
				{run.repoName}
			</span>
			<span className="border-base-200 bg-base-50 text-base-500 flex-none rounded-full border px-2 py-0.5 font-mono text-[11px]">
				vps
			</span>
			<span
				className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-medium ${envPillClass(run.environment)}`}
			>
				{isProd ? 'prod' : 'preview'}
			</span>
			<span className="text-base-500 flex-none font-mono text-xs whitespace-nowrap">
				{formatRelative(Date.parse(run.createdAt), nowMs)}
			</span>
			<span className="text-base-400 flex-none">
				<DeployIcon name="external" size={13} />
			</span>
		</a>
	)
}
