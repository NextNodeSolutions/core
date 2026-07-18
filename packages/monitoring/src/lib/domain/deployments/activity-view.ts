import {
	deploymentCommitLabel,
	deploymentDisplayStatus,
} from '@/lib/domain/cloudflare/deployment-summary.ts'
import { activityKey } from '@/lib/domain/deployments/deployment-activity.ts'
import {
	vpsRunDisplayStatus,
	vpsRunShortSha,
} from '@/lib/domain/github/vps-deploy-run.ts'
import { EMPTY_LABEL } from '@/lib/domain/monitoring/format.ts'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeploymentEnvironment } from '@/lib/domain/cloudflare/pages-deployment.ts'
import type { ActivityEntry } from '@/lib/domain/deployments/deployment-activity.ts'

/**
 * The ONE view-model of a merged-feed activity row. Every renderer (the
 * overview .astro list, the deployments island) consumes this same shape, so
 * "what a row shows" is decided exactly once per source kind - the per-kind
 * ternaries that used to be copied in OverviewContent.astro and the island
 * rows (and had already drifted) collapse into the per-kind builders below.
 *
 * The row carries `createdAtMs`, never a formatted "ago": relative time is
 * rendered at the edge with each consumer's own injected clock. Navigation is
 * the one axis that cannot be shared across SSR and the island, so it is
 * expressed as the semantic `target` union - each renderer interprets the two
 * target kinds (never the source kind) in its own 2-case projection.
 */

export type ActivityTarget =
	| { readonly kind: 'external'; readonly href: string }
	| {
			readonly kind: 'deployment'
			readonly projectName: string
			readonly deploymentId: string
	  }

export interface ActivityRowView {
	readonly key: string
	readonly source: ActivityEntry['kind']
	readonly display: DeployDisplayStatus
	readonly title: string
	readonly branch: string
	readonly commit: string
	/** The owning project / repo, rendered as the row's context pill. */
	readonly contextLabel: string
	readonly environment: CloudflarePagesDeploymentEnvironment
	readonly createdAtMs: number
	readonly target: ActivityTarget
}

const pagesRowView = (
	entry: Extract<ActivityEntry, { kind: 'pages' }>,
): ActivityRowView => ({
	key: activityKey(entry),
	source: 'pages',
	display: deploymentDisplayStatus(entry.deployment.status),
	// A message-less deployment falls back to its shortId (the island rows'
	// historical rule, now the shared one - not the former '(sans message)').
	title: entry.deployment.commitMessage ?? entry.deployment.shortId,
	branch: entry.deployment.branch ?? EMPTY_LABEL,
	commit: deploymentCommitLabel(entry.deployment),
	contextLabel: entry.projectName,
	environment: entry.deployment.environment,
	createdAtMs: Date.parse(entry.deployment.createdAt),
	target: {
		kind: 'deployment',
		projectName: entry.projectName,
		deploymentId: entry.deployment.id,
	},
})

const vpsRowView = (
	entry: Extract<ActivityEntry, { kind: 'vps' }>,
): ActivityRowView => ({
	key: activityKey(entry),
	source: 'vps',
	display: vpsRunDisplayStatus(entry.run),
	title: entry.run.title || entry.run.workflowName,
	branch: entry.run.branch ?? EMPTY_LABEL,
	commit: vpsRunShortSha(entry.run),
	contextLabel: entry.run.repoName,
	environment: entry.run.environment,
	createdAtMs: Date.parse(entry.run.createdAt),
	target: { kind: 'external', href: entry.run.htmlUrl },
})

export const activityRowView = (entry: ActivityEntry): ActivityRowView => {
	switch (entry.kind) {
		case 'pages':
			return pagesRowView(entry)
		case 'vps':
			return vpsRowView(entry)
	}
	// no default: a new ActivityEntry kind makes this switch non-exhaustive
	// and fails to compile until it gets a builder.
}
