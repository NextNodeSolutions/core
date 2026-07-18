import { useState } from 'react'

import { createStore, Provider } from 'jotai'

import {
	ALL_ENV,
	envAtom,
	isEnvFilter,
	nowMsAtom,
	projectAtom,
	seedAtom,
	selAtom,
} from '@/islands/deployments/atoms.ts'
import { DeploymentsScreen } from '@/islands/deployments/DeploymentsScreen.tsx'

import type { DeploymentsSeed } from '@/islands/deployments/atoms.ts'

/**
 * Root of the dynamic /deployments island. It builds a private Jotai store ONCE
 * per mount and seeds it - the projects + deployments the server already loaded,
 * plus the initial project / env / selection from the URL (for deep-linking)
 * and a stable `nowMs` - BEFORE any child reads an atom. Every interaction
 * (selecting a project, switching the env tab, opening a deployment) is then a
 * plain atom write derived from that seed: no refetch, no navigation, no scroll
 * jump. There is no Suspense because nothing fetches on an interaction. Mounted
 * in deployments/index.astro with `client:load`.
 */

interface DeploymentsProps {
	readonly data: DeploymentsSeed
	readonly initialProject: string
	readonly initialEnv: string
	readonly initialSel: string
	readonly nowMs: number
}

export function Deployments({
	data,
	initialProject,
	initialEnv,
	initialSel,
	nowMs,
}: DeploymentsProps): React.ReactElement {
	// `useState` initializer runs once: create + seed the store before render
	// reads it, without mutating anything React owns on re-render.
	const [store] = useState(() => {
		const seeded = createStore()
		seeded.set(seedAtom, data)
		seeded.set(projectAtom, initialProject)
		// The URL param is untrusted; an unknown env falls back to the full view.
		seeded.set(envAtom, isEnvFilter(initialEnv) ? initialEnv : ALL_ENV)
		seeded.set(selAtom, initialSel)
		seeded.set(nowMsAtom, nowMs)
		return seeded
	})

	return (
		<Provider store={store}>
			<DeploymentsScreen />
		</Provider>
	)
}
