import type { RecentDeployment } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

/**
 * The merged deployments activity feed: Cloudflare Pages deployments and
 * GitHub Actions VPS deploy runs interleaved newest-first. Pure selectors -
 * the adapters load each source independently and hand both lists here.
 */

export type ActivityEntry =
	| {
			readonly kind: 'pages'
			readonly projectName: string
			readonly deployment: RecentDeployment['deployment']
	  }
	| { readonly kind: 'vps'; readonly run: VpsDeployRun }

/** Derived from the entry union so a new source kind auto-extends the filter. */
export type ActivitySourceFilter = 'all' | ActivityEntry['kind']

export const activityCreatedAt = (entry: ActivityEntry): string =>
	entry.kind === 'pages' ? entry.deployment.createdAt : entry.run.createdAt

/** Stable per-entry key for list rendering (ids are only unique per source). */
export const activityKey = (entry: ActivityEntry): string =>
	entry.kind === 'pages'
		? `pages:${entry.deployment.id}`
		: `vps:${entry.run.id}`

export const mergeActivity = (
	pages: ReadonlyArray<RecentDeployment>,
	runs: ReadonlyArray<VpsDeployRun>,
): ReadonlyArray<ActivityEntry> => [
	...pages.map(entry => ({ kind: 'pages' as const, ...entry })),
	...runs.map(run => ({ kind: 'vps' as const, run })),
]

/** Filter by source, sort newest-first (ISO timestamps), cap to `limit`. */
export const selectRecentActivity = (
	entries: ReadonlyArray<ActivityEntry>,
	source: ActivitySourceFilter,
	limit: number,
): ReadonlyArray<ActivityEntry> =>
	entries
		.filter(entry => source === 'all' || entry.kind === source)
		.toSorted((left, right) =>
			activityCreatedAt(right).localeCompare(activityCreatedAt(left)),
		)
		.slice(0, limit)
