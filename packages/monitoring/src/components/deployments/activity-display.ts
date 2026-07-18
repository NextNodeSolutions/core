import type { CloudflarePagesDeploymentEnvironment } from '@/lib/domain/cloudflare/pages-deployment.ts'
import type {
	ActivityEntry,
	ActivitySourceFilter,
} from '@/lib/domain/deployments/deployment-activity.ts'

/**
 * Presentation maps for the merged activity feed, shared by the overview
 * .astro list and the deployments island (same slot as
 * `components/cloudflare/deploy-display.ts`, which both already import for
 * the status icon/colour). Domain (`activity-view.ts`) says WHAT a row is;
 * this module says HOW it looks. The env pill used to exist as three drifted
 * inline copies (text-accent-700 / -800) - the `satisfies Record` maps are
 * now the only source, and a new source kind fails to compile until it gets
 * a pill label.
 */

export const ENV_PILL_CLASS = {
	production: 'border-accent-200 bg-accent-50 text-accent-700',
	preview: 'border-base-200 bg-base-100 text-base-600',
} satisfies Record<CloudflarePagesDeploymentEnvironment, string>

export const ENV_PILL_LABEL = {
	production: 'prod',
	preview: 'preview',
} satisfies Record<CloudflarePagesDeploymentEnvironment, string>

export const SOURCE_PILL_LABEL = {
	pages: 'pages',
	vps: 'vps',
} satisfies Record<ActivityEntry['kind'], string>

/** The context (project/repo) and source pills, identical in both renderers. */
export const CONTEXT_PILL_CLASS =
	'rounded-full border border-base-200 bg-base-100 px-2 py-0.5 font-mono text-[11px] text-base-700'

export const SOURCE_PILL_CLASS =
	'rounded-full border border-base-200 bg-base-50 px-2 py-0.5 font-mono text-[11px] text-base-500'

/** The source tabs' option list ('Tous' is UI copy, so it lives UI-side). */
export const ACTIVITY_SOURCE_OPTIONS = [
	{ key: 'all', label: 'Tous' },
	{ key: 'pages', label: 'Pages' },
	{ key: 'vps', label: 'VPS' },
] as const satisfies ReadonlyArray<{
	readonly key: ActivitySourceFilter
	readonly label: string
}>
