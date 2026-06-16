import { useAtomValue } from 'jotai'

import { historyDeploymentsAtom } from '@/islands/deployments/atoms.ts'
import { DeploymentRow } from '@/islands/deployments/DeploymentRow.tsx'
import { EnvFilterTabs } from '@/islands/deployments/EnvFilterTabs.tsx'

/**
 * The "Historique des déploiements" section of the detail view: the env filter
 * tabs and the deployments table, both reading the seeded, env-filtered history
 * (no fetch on a tab change). The table head + empty state + layout match
 * DeploymentsContent.astro verbatim.
 */

const HISTORY_COLUMN_COUNT = 6

export function DeploymentHistoryTable(): React.ReactElement {
	const history = useAtomValue(historyDeploymentsAtom)

	return (
		<>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
				<span className="text-base-900 text-sm font-semibold">
					Historique des déploiements
				</span>
				<EnvFilterTabs />
			</div>

			<div className="border-base-200 shadow-subtle overflow-hidden rounded-xl border bg-white">
				<div className="overflow-x-auto">
					<table className="w-full min-w-[620px] text-left text-sm">
						<thead>
							<tr className="border-base-100 text-base-400 border-b font-mono text-[10px] tracking-[0.04em] uppercase">
								<th className="w-8 px-4 py-2" />
								<th className="px-2 py-2">Déploiement</th>
								<th className="px-2 py-2">Branche</th>
								<th className="px-2 py-2">Env</th>
								<th className="px-2 py-2">Durée</th>
								<th className="px-4 py-2 text-right">Quand</th>
							</tr>
						</thead>
						<tbody>
							{history.length === 0 ? (
								<tr>
									<td
										colSpan={HISTORY_COLUMN_COUNT}
										className="text-base-400 px-4 py-12 text-center"
									>
										Aucun déploiement pour ce filtre.
									</td>
								</tr>
							) : (
								history.map(deployment => (
									<DeploymentRow
										key={deployment.id}
										deployment={deployment}
									/>
								))
							)}
						</tbody>
					</table>
				</div>
			</div>
		</>
	)
}
