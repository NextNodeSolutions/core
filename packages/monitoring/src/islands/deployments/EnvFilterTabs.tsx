import { useAtom, useSetAtom } from 'jotai'

import { envAtom, selAtom } from '@/islands/deployments/atoms.ts'

/**
 * The Tous / Production / Preview segmented control over the history table.
 * Selecting a tab sets `envAtom` (and clears the open drawer, mirroring the
 * former `linkTo({ env, sel: null })`) instead of navigating - the history
 * recomputes client-side with no reload. Visual style matches the .astro tabs
 * 1:1.
 */

const ENV_OPTIONS: ReadonlyArray<{
	readonly key: string
	readonly label: string
}> = [
	{ key: 'all', label: 'Tous' },
	{ key: 'production', label: 'Production' },
	{ key: 'preview', label: 'Preview' },
]

export function EnvFilterTabs(): React.ReactElement {
	const [env, setEnv] = useAtom(envAtom)
	const setSel = useSetAtom(selAtom)

	const selectEnv = (key: string): void => {
		setEnv(key)
		setSel('')
	}

	return (
		<div
			className="border-base-200 inline-flex rounded-full border bg-white p-0.5"
			role="tablist"
			aria-label="Filtrer par environnement"
		>
			{ENV_OPTIONS.map(option => {
				const active = env === option.key
				return (
					<button
						type="button"
						key={option.key}
						role="tab"
						aria-selected={active}
						onClick={() => selectEnv(option.key)}
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
