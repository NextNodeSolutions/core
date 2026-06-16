import { atom } from 'jotai'

import {
	ALL_ENV,
	envAtom,
	projectAtom,
	selAtom,
} from '@/islands/deployments/atoms.ts'

/**
 * Write-only action atoms for the deployments island's navigation-as-state.
 * Each one mirrors a former `linkTo({…})` query transition, but as a plain
 * multi-atom write: no router, no reload, no scroll jump. Grouping the
 * coupled writes here keeps every "which atoms change together" rule in one
 * place instead of scattering `setProject(); setEnv(); setSel()` across click
 * handlers.
 */

/** Open a project's detail view, resetting the env filter and closing the drawer. */
export const selectProjectAtom = atom(null, (_get, set, name: string) => {
	set(projectAtom, name)
	set(envAtom, ALL_ENV)
	set(selAtom, '')
})

/** Back to the all-projects master view: clear project + env + drawer. */
export const clearProjectAtom = atom(null, (_get, set) => {
	set(projectAtom, '')
	set(envAtom, ALL_ENV)
	set(selAtom, '')
})

/**
 * Open a deployment from the recent-activity list: select its owning project
 * AND open its drawer in one transition (mirrors `linkTo({ project, sel })`).
 */
export const openRecentDeploymentAtom = atom(
	null,
	(_get, set, entry: { projectName: string; deploymentId: string }) => {
		set(projectAtom, entry.projectName)
		set(selAtom, entry.deploymentId)
	},
)
