import { useAtom } from 'jotai'

import { sourceAtom } from '@/islands/deployments/atoms.ts'

import type { ActivitySourceFilter } from '@/lib/domain/deployments/deployment-activity.ts'

/**
 * The Tous / Pages / VPS segmented control over the recent-activity list.
 * Selecting a tab sets `sourceAtom`; the merged feed recomputes client-side
 * with no reload. Visual style mirrors EnvFilterTabs 1:1.
 */

const SOURCE_OPTIONS: ReadonlyArray<{
	readonly key: ActivitySourceFilter
	readonly label: string
}> = [
	{ key: 'all', label: 'Tous' },
	{ key: 'pages', label: 'Pages' },
	{ key: 'vps', label: 'VPS' },
]

export function SourceFilterTabs(): React.ReactElement {
	const [source, setSource] = useAtom(sourceAtom)

	return (
		<div
			className="border-base-200 inline-flex rounded-full border bg-white p-0.5"
			role="tablist"
			aria-label="Filtrer par source"
		>
			{SOURCE_OPTIONS.map(option => {
				const active = source === option.key
				return (
					<button
						type="button"
						key={option.key}
						role="tab"
						aria-selected={active}
						onClick={() => setSource(option.key)}
						className={`rounded-full px-3 py-1 text-xs font-medium ${
							active
								? 'bg-base-900 text-white'
								: 'text-base-600 hover:bg-base-50'
						}`}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
