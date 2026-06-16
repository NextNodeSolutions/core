import { useAtomValue } from 'jotai'

import { nowMsAtom, recentActivityAtom } from '@/islands/deployments/atoms.ts'
import { RecentActivityRow } from '@/islands/deployments/RecentActivityRow.tsx'

/**
 * The "Activité récente · tous projets" list on the master view. Reads the
 * seeded, capped recent-activity derivation and renders one row per entry (each
 * row owns its own click handler). Shows the empty state when there is nothing
 * to list. No fetch.
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
			{recent.map(entry => (
				<RecentActivityRow
					key={entry.deployment.id}
					entry={entry}
					nowMs={nowMs}
				/>
			))}
		</div>
	)
}
