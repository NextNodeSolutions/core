import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import {
	CONTEXT_PILL_CLASS,
	ENV_PILL_CLASS,
	ENV_PILL_LABEL,
	SOURCE_PILL_CLASS,
	SOURCE_PILL_LABEL,
} from '@/components/deployments/activity-display.ts'
import { statusIcon } from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'
import { formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { ActivityRowView } from '@/lib/domain/deployments/activity-view.ts'

/**
 * The cells every activity row shows, whatever its target: status glyph,
 * title + branch/commit sub-line, context/source/env pills, relative time.
 * Everything comes straight off the shared `ActivityRowView`; the row SHELL
 * (link vs drawer button) lives in ActivityRow.tsx. Same split as
 * DeploymentRow / DeploymentRowCommit.
 */

interface ActivityRowCellsProps {
	readonly view: ActivityRowView
	readonly nowMs: number
}

export function ActivityRowCells({
	view,
	nowMs,
}: ActivityRowCellsProps): React.ReactElement {
	return (
		<>
			<span className={`flex-none ${DEPLOY_STATUS_COLOR[view.display]}`}>
				<DeployIcon name={statusIcon[view.display]} size={15} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-base-900 truncate text-[13.5px] font-medium">
					{view.title}
				</div>
				<div className="text-base-500 font-mono text-[11px]">
					{view.branch} · {view.commit}
				</div>
			</div>
			<span className={`flex-none ${CONTEXT_PILL_CLASS}`}>
				{view.contextLabel}
			</span>
			<span className={`flex-none ${SOURCE_PILL_CLASS}`}>
				{SOURCE_PILL_LABEL[view.source]}
			</span>
			<span
				className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-medium ${ENV_PILL_CLASS[view.environment]}`}
			>
				{ENV_PILL_LABEL[view.environment]}
			</span>
			<span className="text-base-500 flex-none font-mono text-xs whitespace-nowrap">
				{formatRelative(view.createdAtMs, nowMs)}
			</span>
		</>
	)
}
