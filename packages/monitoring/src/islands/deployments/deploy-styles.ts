import {
	EMPTY_LABEL,
	formatDurationSeconds,
} from '@/lib/domain/monitoring/format.ts'

import type { DeployIconName } from '@/islands/deployments/DeployIcon.tsx'
import type {
	DeployDisplayStatus,
	StepState,
} from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * The single home for the deployments island's Tailwind class maps and the
 * small display helpers that used to live in the DeploymentsContent.astro
 * frontmatter (status badge / label / strip / pipeline-step colours, the
 * success-rate tint, commit + duration labels). Copied verbatim from the .astro
 * so the island and any server-rendered sibling agree on the palette -
 * duplicating these per component would let the colours drift apart silently.
 * The icon + text-colour maps stay in `deploy-display.ts` (shared with the
 * overview screen); we reuse them rather than re-declare them here.
 */

const HIGH_SUCCESS_RATE = 90
const MID_SUCCESS_RATE = 70
const STRIP_BASE_OPACITY = 0.35
const STRIP_GRADED_RANGE = 0.65

// The island-local aliases for the shared domain display rules.
export { EMPTY_LABEL as EMPTY_VALUE } from '@/lib/domain/monitoring/format.ts'
export { deploymentCommitLabel as commitLabel } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * The DeployIcon glyph per display status. Mirrors the shared
 * `DEPLOY_STATUS_ICON` map (which is typed against Astro's wider `IconName`),
 * but narrowed to the island's `DeployIconName` so the inline React glyphs stay
 * decoupled from the Astro icon set. The glyph choice is the same knowledge -
 * any change must move in lockstep with `deploy-display.ts`.
 */
export const statusIcon: Record<DeployDisplayStatus, DeployIconName> = {
	ready: 'check',
	building: 'refresh',
	error: 'x',
	idle: 'dot',
}

export const statusBadgeClass: Record<DeployDisplayStatus, string> = {
	ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
	building: 'border-sky-200 bg-sky-50 text-sky-700',
	error: 'border-red-200 bg-red-50 text-red-700',
	idle: 'border-base-200 bg-base-100 text-base-600',
}

export const statusLabel: Record<DeployDisplayStatus, string> = {
	ready: 'prêt',
	building: 'build',
	error: 'échec',
	idle: 'idle',
}

export const stripBg: Record<DeployDisplayStatus, string> = {
	ready: 'bg-emerald-600',
	building: 'bg-sky-600',
	error: 'bg-red-600',
	idle: 'bg-base-400',
}

export const stepDotClass: Record<StepState, string> = {
	done: 'bg-emerald-600 text-white',
	active: 'bg-sky-600 text-white',
	failed: 'bg-red-600 text-white',
	pending: 'bg-base-200 text-base-400',
}

export const stepLabelClass: Record<StepState, string> = {
	done: 'font-semibold text-base-900',
	active: 'font-semibold text-base-900',
	failed: 'font-semibold text-red-600',
	pending: 'font-medium text-base-500',
}

export const successRateClass = (rate: number | null): string => {
	if (rate === null) return 'text-base-400'
	if (rate >= HIGH_SUCCESS_RATE) return 'text-emerald-600'
	if (rate >= MID_SUCCESS_RATE) return 'text-amber-600'
	return 'text-red-600'
}

export const successRateLabel = (rate: number | null): string =>
	rate === null ? EMPTY_LABEL : `${String(rate)}%`

export const durationLabel = (deployment: CloudflarePagesDeployment): string =>
	formatDurationSeconds(
		Date.parse(deployment.modifiedAt) - Date.parse(deployment.createdAt),
	)

export const stripOpacity = (index: number, count: number): number =>
	STRIP_BASE_OPACITY + (STRIP_GRADED_RANGE * (count - index)) / count

/** The pipeline-step glyph for each state (null = the small neutral dot). */
export const stepDotIcon: Record<StepState, DeployIconName | null> = {
	done: 'check',
	active: 'refresh',
	failed: 'x',
	pending: null,
}
