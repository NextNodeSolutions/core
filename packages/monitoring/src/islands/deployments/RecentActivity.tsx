import { useAtomValue } from 'jotai'

import { nowMsAtom, recentActivityAtom } from '@/islands/deployments/atoms.ts'
import { RecentActivityRow } from '@/islands/deployments/RecentActivityRow.tsx'
import { VpsActivityRow } from '@/islands/deployments/VpsActivityRow.tsx'
import { activityKey } from '@/lib/domain/deployments/deployment-activity.ts'

/**
 * The "Activité récente · tous projets" list on the master view. Reads the
 * seeded, merged (Pages + VPS) recent-activity derivation and renders one row
 * per entry: a Pages entry opens its drawer, a VPS run links to its GitHub
 * page. Shows the empty state when there is nothing to list. No fetch.
 */

export function RecentActivity(): React.ReactElement {
	const recent = useAtomValue(recentActivityAtom)
	const nowMs = useAtomValue(nowMsAtom)

	if (recent.length === 0) {
		return (
			<div className="border-base-200 shadow-subtle text-base-400 overflow-hidden rounded-xl border bg-white px-4 py-12 text-center text-sm">
				Aucun déploiement récent.
			</div>
		)
	}

	return (
		<div className="border-base-200 shadow-subtle overflow-hidden rounded-xl border bg-white">
			{recent.map(entry =>
				entry.kind === 'pages' ? (
					<RecentActivityRow
						key={activityKey(entry)}
						entry={entry}
						nowMs={nowMs}
					/>
				) : (
					<VpsActivityRow
						key={activityKey(entry)}
						run={entry.run}
						nowMs={nowMs}
					/>
				),
			)}
		</div>
	)
}
