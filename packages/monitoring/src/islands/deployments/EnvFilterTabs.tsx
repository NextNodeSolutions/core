import { useAtom, useSetAtom } from 'jotai'

import { envAtom, selAtom } from '@/islands/deployments/atoms.ts'
import { FilterTabs } from '@/islands/deployments/FilterTabs.tsx'

import type { EnvFilter } from '@/islands/deployments/atoms.ts'
import type { FilterTabOption } from '@/islands/deployments/FilterTabs.tsx'

/**
 * The Tous / Production / Preview segmented control over the history table.
 * Selecting a tab sets `envAtom` (and clears the open drawer, mirroring the
 * former `linkTo({ env, sel: null })`) instead of navigating - the history
 * recomputes client-side with no reload.
 */

const ENV_OPTIONS: ReadonlyArray<FilterTabOption<EnvFilter>> = [
	{ key: 'all', label: 'Tous' },
	{ key: 'production', label: 'Production' },
	{ key: 'preview', label: 'Preview' },
]

export function EnvFilterTabs(): React.ReactElement {
	const [env, setEnv] = useAtom(envAtom)
	const setSel = useSetAtom(selAtom)

	const selectEnv = (key: EnvFilter): void => {
		setEnv(key)
		setSel('')
	}

	return (
		<FilterTabs
			options={ENV_OPTIONS}
			selected={env}
			onSelect={selectEnv}
			ariaLabel="Filtrer par environnement"
		/>
	)
}
