import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

import {
	deploymentDisplayStatus,
	summarizeProject,
} from '@/lib/domain/cloudflare/deployment-summary.ts'
import {
	mergeActivity,
	selectRecentActivity,
} from '@/lib/domain/deployments/deployment-activity.ts'

import type {
	DeployDisplayStatus,
	ProjectSummary,
	RecentDeployment,
} from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import type {
	ActivityEntry,
	ActivitySourceFilter,
} from '@/lib/domain/deployments/deployment-activity.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

/**
 * State for the dynamic /deployments island. The server already fanned out and
 * loaded every project + its deployments; that whole set is seeded once
 * (`seedAtom`) and EVERY view - the project grid, recent activity, the selected
 * project's filtered history, the selected deployment - is derived client-side
 * from it with the pure domain fns. Selecting a project, switching the env
 * filter, opening a deployment drawer are all plain atom writes: no network, no
 * navigation, no scroll jump. Mirrors the logs island's primitive-plus-derived
 * split, minus the async loader (there is nothing to fetch on an interaction).
 */

const ACTIVITY_LIMIT = 8

export const ALL_ENV = 'all'

/** The deployments + projects the server loaded, seeded once from props. */
export interface DeploymentsSeed {
	readonly projects: ReadonlyArray<CloudflarePagesProject>
	readonly deploymentsByProject: Record<
		string,
		ReadonlyArray<CloudflarePagesDeployment>
	>
	readonly vpsRuns: ReadonlyArray<VpsDeployRun>
}

const EMPTY_SEED: DeploymentsSeed = {
	projects: [],
	deploymentsByProject: {},
	vpsRuns: [],
}

// --- Selection primitives (drive the always-interactive master/detail UI) ---

/** The selected project's name; '' = the all-projects master view. */
export const projectAtom = atom('')

/** The history env filter: 'all' | 'production' | 'preview'. */
export const envAtom = atom(ALL_ENV)

/** The recent-activity source filter: 'all' | 'pages' | 'vps'. */
export const sourceAtom = atom<ActivitySourceFilter>('all')

/** The open deployment's id; '' = no drawer. */
export const selAtom = atom('')

/** A stable "now" injected from the server so relative times are deterministic. */
export const nowMsAtom = atom(0)

/** Seeded once from server props; the source every derived view reads. */
export const seedAtom = atom<DeploymentsSeed>(EMPTY_SEED)

const deploymentsFor = (
	seed: DeploymentsSeed,
	projectName: string,
): ReadonlyArray<CloudflarePagesDeployment> =>
	seed.deploymentsByProject[projectName] ?? []

// --- Master-view derivations (the all-projects grid + recent activity) ---

/** A project card's summary + the display status of its current deployment. */
export interface ProjectView {
	readonly project: CloudflarePagesProject
	readonly summary: ProjectSummary
	readonly currentDisplay: DeployDisplayStatus
}

/** One card per project, summarised from its seeded deployments. */
export const projectViewsAtom = atom<ReadonlyArray<ProjectView>>(get => {
	const seed = get(seedAtom)
	return seed.projects.map(project => {
		const summary = summarizeProject(deploymentsFor(seed, project.name))
		return {
			project,
			summary,
			currentDisplay: deploymentDisplayStatus(
				summary.current?.status ?? 'unknown',
			),
		}
	})
})

/** Project count, for the master-view header. */
export const projectCountAtom = atom(get => get(seedAtom).projects.length)

/**
 * Newest-first activity across all sources (Cloudflare Pages deployments +
 * GitHub VPS deploy runs), filtered by the source tab, capped for the list.
 */
export const recentActivityAtom = atom<ReadonlyArray<ActivityEntry>>(get => {
	const seed = get(seedAtom)
	const pagesEntries = seed.projects.flatMap(project =>
		deploymentsFor(seed, project.name).map(deployment => ({
			projectName: project.name,
			deployment,
		})),
	)
	return selectRecentActivity(
		mergeActivity(pagesEntries, seed.vpsRuns),
		get(sourceAtom),
		ACTIVITY_LIMIT,
	)
})

// --- Per-project detail derivations (selected project's header + history) ---

/** The selected project record, or null on the master view / unknown name. */
export const selectedProjectAtom = atom<CloudflarePagesProject | null>(get => {
	const name = get(projectAtom)
	if (name === '') return null
	return get(seedAtom).projects.find(project => project.name === name) ?? null
})

/** The selected project's full summary (header stats + strips). */
export const detailSummaryAtom = atom<ProjectSummary | null>(get => {
	const project = get(selectedProjectAtom)
	if (project === null) return null
	return summarizeProject(deploymentsFor(get(seedAtom), project.name))
})

/** The selected project's deployments filtered by the active env tab. */
export const historyDeploymentsAtom = atom<
	ReadonlyArray<CloudflarePagesDeployment>
>(get => {
	const project = get(selectedProjectAtom)
	if (project === null) return []
	const env = get(envAtom)
	return deploymentsFor(get(seedAtom), project.name).filter(
		deployment => env === ALL_ENV || deployment.environment === env,
	)
})

/**
 * Per-id "is this deployment selected" booleans. A history row subscribes only
 * to its own atom, so opening the drawer re-renders just the two affected rows
 * (the old and the new), never the whole table.
 */
export const isSelectedFamily = atomFamily((id: string) =>
	atom(get => get(selAtom) === id),
)

// --- Drawer derivation (the selected deployment + its owning project) ---

/** The open deployment together with its project name; null when none open. */
export const selectedEntryAtom = atom<RecentDeployment | null>(get => {
	const id = get(selAtom)
	if (id === '') return null
	const seed = get(seedAtom)
	for (const project of seed.projects) {
		const deployment = deploymentsFor(seed, project.name).find(
			candidate => candidate.id === id,
		)
		if (deployment) return { projectName: project.name, deployment }
	}
	return null
})
