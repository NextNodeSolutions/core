import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

export interface WaitOptions<T> {
	readonly subject: string
	readonly poll: () => Promise<T>
	readonly isDone: (value: T) => boolean
	readonly detail?: (value: T) => string
	readonly maxAttempts: number
	readonly intervalMs: number
}

/**
 * Wait for `options.isDone` to return true by sequentially polling
 * `options.poll`, or throw once the attempt budget is exhausted.
 *
 * Every non-terminal attempt logs a progress line and sleeps
 * `options.intervalMs`. The final attempt does not sleep so the timeout
 * fires at the end of the last check, not after an extra delay.
 *
 * Log format (uniform across all callers):
 * - success:  `<subject>: done`
 * - progress: `<subject>: <detail> (attempt <n>/<max>)` (or without `<detail>: `
 *             if no `detail` formatter was provided)
 * - timeout:  `<subject>: timed out after <max> attempts` (thrown)
 */
export async function waitUntil<T>(options: WaitOptions<T>): Promise<T> {
	for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
		const value = await options.poll()
		if (options.isDone(value)) {
			logger.info(`${options.subject}: done`)
			return value
		}
		const detail = options.detail ? `${options.detail(value)} ` : ''
		logger.info(
			`${options.subject}: ${detail}(attempt ${String(attempt)}/${String(options.maxAttempts)})`,
		)
		if (attempt < options.maxAttempts) {
			// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
			await sleep(options.intervalMs)
		}
	}

	throw new Error(
		`${options.subject}: timed out after ${String(options.maxAttempts)} attempts`,
	)
}
