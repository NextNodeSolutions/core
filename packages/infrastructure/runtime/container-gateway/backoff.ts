// The backoff between two starts of an image that fails to listen: a boot is
// billed until the process exits, and without a backoff every request would
// pay for one. The delay doubles from 15 s to 5 min, and a new release
// starts afresh. Pure: the Durable Object stores and reads the value.

export const START_BACKOFF_BASE_MS = 15_000
// Each failure of the same release doubles the wait.
export const START_BACKOFF_FACTOR = 2
export const START_BACKOFF_MAX_MS = 300_000
const MS_PER_SECOND = 1000

export interface StartBackoff {
	// The release the failures belong to.
	readonly release: string
	readonly failures: number
	// No start is attempted before this time (epoch ms).
	readonly until: number
}

export function isStartBackoff(candidate: unknown): candidate is StartBackoff {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		'release' in candidate &&
		typeof candidate.release === 'string' &&
		'failures' in candidate &&
		typeof candidate.failures === 'number' &&
		'until' in candidate &&
		typeof candidate.until === 'number'
	)
}

/** How long `release` must still wait before a start, 0 when it may start. */
export function remainingBackoffMs(
	backoff: StartBackoff | undefined,
	release: string,
	now: number,
): number {
	if (!backoff || backoff.release !== release) return 0
	return Math.max(0, backoff.until - now)
}

/** The backoff after one more failed start of `release`. */
export function nextStartBackoff(
	previous: StartBackoff | undefined,
	release: string,
	now: number,
): StartBackoff {
	const failures = previous?.release === release ? previous.failures + 1 : 1
	const delay = Math.min(
		START_BACKOFF_BASE_MS * START_BACKOFF_FACTOR ** (failures - 1),
		START_BACKOFF_MAX_MS,
	)
	return { release, failures, until: now + delay }
}

/** A `Retry-After` value: whole seconds, at least one. */
export function toRetryAfterSeconds(delayMs: number): number {
	return Math.max(1, Math.ceil(delayMs / MS_PER_SECOND))
}
