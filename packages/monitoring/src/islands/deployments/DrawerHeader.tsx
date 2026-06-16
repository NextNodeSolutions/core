import { useSetAtom } from 'jotai'

import { DEPLOY_STATUS_COLOR } from '@/components/cloudflare/deploy-display.ts'
import { selAtom } from '@/islands/deployments/atoms.ts'
import {
	statusBadgeClass,
	statusIcon,
	statusLabel,
} from '@/islands/deployments/deploy-styles.ts'
import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The sticky drawer header: the status glyph, the deployment short id, the
 * status badge, and the close button (clears `selAtom`, no navigation). Split
 * out of DeploymentDrawer to keep its render small. Markup copied verbatim from
 * DeploymentsContent.astro.
 */

interface DrawerHeaderProps {
	readonly shortId: string
	readonly display: DeployDisplayStatus
}

export function DrawerHeader({
	shortId,
	display,
}: DrawerHeaderProps): React.ReactElement {
	const setSel = useSetAtom(selAtom)

	return (
		<div className="border-base-200 sticky top-0 z-2 flex items-center justify-between border-b bg-white px-4.5 py-3.5">
			<div className="flex min-w-0 items-center gap-2.5">
				<span className={`flex-none ${DEPLOY_STATUS_COLOR[display]}`}>
					<DeployIcon name={statusIcon[display]} size={16} />
				</span>
				<span className="text-base-900 truncate font-mono text-sm font-bold">
					{shortId}
				</span>
				<span
					className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusBadgeClass[display]}`}
				>
					{statusLabel[display]}
				</span>
			</div>
			<button
				type="button"
				onClick={() => setSel('')}
				className="text-base-500 hover:bg-base-50 hover:text-base-900 rounded-full p-1"
				aria-label="Fermer le détail"
			>
				<DeployIcon name="x" size={16} />
			</button>
		</div>
	)
}
