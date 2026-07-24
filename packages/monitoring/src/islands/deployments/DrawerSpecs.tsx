import { durationLabel } from '@/islands/deployments/deploy-styles.ts'
import { EMPTY_LABEL, formatRelative } from '@/lib/domain/monitoring/format.ts'

import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The 2-column specs grid in the drawer: project, author, build duration and
 * the relative start time of the selected deployment. Pure presentational -
 * the values come straight from the deployment + the seeded `nowMs`. Layout
 * copied verbatim from the .astro drawer.
 */

interface DrawerSpecsProps {
	readonly projectName: string
	readonly deployment: CloudflarePagesDeployment
	readonly nowMs: number
}

export function DrawerSpecs({
	projectName,
	deployment,
	nowMs,
}: DrawerSpecsProps): React.ReactElement {
	const specs: ReadonlyArray<{
		readonly label: string
		readonly text: string
	}> = [
		{ label: 'Projet', text: projectName },
		{ label: 'Auteur', text: deployment.author ?? EMPTY_LABEL },
		{ label: 'Durée', text: durationLabel(deployment) },
		{
			label: 'Démarré',
			text: formatRelative(Date.parse(deployment.createdAt), nowMs),
		},
	]

	return (
		<div className="grid grid-cols-2 gap-3">
			{specs.map(spec => (
				<div key={spec.label}>
					<div className="text-base-400 text-[11px]">
						{spec.label}
					</div>
					<div className="text-base-900 mt-0.5 text-[13px]">
						{spec.text}
					</div>
				</div>
			))}
		</div>
	)
}
