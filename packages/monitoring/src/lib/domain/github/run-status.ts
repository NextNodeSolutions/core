/**
 * Shared classification of a GitHub Actions run's status/conclusion pair.
 * `runPhase` is the single strategy point: downstream screens project a phase
 * onto their own display union through an exhaustive Record instead of each
 * re-deriving it from the raw pair.
 *
 * `queued` (waiting/queued) and `pending` (pending/requested) stay distinct:
 * the projects screen surfaces only the former as "queued" and treats the
 * latter as unknown, while the deployments feed collapses both into building.
 */

const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set([
	'failure',
	'cancelled',
	'timed_out',
])

export type RunPhase =
	| 'queued'
	| 'pending'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'unknown'

const QUEUED_STATUSES: ReadonlySet<string> = new Set(['queued', 'waiting'])
const PENDING_STATUSES: ReadonlySet<string> = new Set(['pending', 'requested'])

const SHORT_SHA_LENGTH = 7

/** The 7-char short form of a run's head sha, shared by every GitHub screen. */
export const shortSha = (headSha: string): string =>
	headSha.slice(0, SHORT_SHA_LENGTH)

export const runPhase = (run: {
	readonly status: string
	readonly conclusion: string | null
}): RunPhase => {
	if (QUEUED_STATUSES.has(run.status)) return 'queued'
	if (PENDING_STATUSES.has(run.status)) return 'pending'
	if (run.status === 'in_progress') return 'running'
	if (run.status !== 'completed') return 'unknown'
	if (run.conclusion === 'success') return 'succeeded'
	if (run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion)) {
		return 'failed'
	}
	return 'unknown'
}
