import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import type { SmokeCheckTarget } from '#/domain/cloudflare/workers/smoke-check.ts'

const logger = createLogger()

// A freshly attached Custom Domain needs DNS + a newly issued edge certificate
// to propagate before the first request succeeds. A one-label host under the
// zone is covered by the existing Universal SSL wildcard and answers in
// seconds, but a two-label-deep host (e.g. dev.admin.example.com) needs its own
// certificate issued on demand - observed at 3-6 minutes on a first greenfield
// deploy. The budget bounds that wait (the loop exits on the first 2xx) before
// declaring the service genuinely unhealthy.
export const SMOKE_CHECK_MAX_ATTEMPTS = 40
export const SMOKE_CHECK_RETRY_DELAY_MS = 15_000
const SMOKE_CHECK_BODY_MAX_LENGTH = 500

export interface SmokeCheckOptions {
	// Injection point for tests; production waits with a real timer.
	readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

function truncate(body: string): string {
	if (body.length <= SMOKE_CHECK_BODY_MAX_LENGTH) return body
	return `${body.slice(0, SMOKE_CHECK_BODY_MAX_LENGTH)}… (truncated)`
}

async function attempt(url: string): Promise<string | undefined> {
	try {
		const response = await fetch(url, { method: 'GET' })
		if (response.ok) return undefined
		const body = truncate(await response.text())
		return `HTTP ${String(response.status)} - ${body}`
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

async function smokeCheckOne(
	target: SmokeCheckTarget,
	wait: (ms: number) => Promise<void>,
): Promise<void> {
	let failure: string | undefined
	for (let tries = 1; tries <= SMOKE_CHECK_MAX_ATTEMPTS; tries += 1) {
		if (tries > 1) {
			// eslint-disable-next-line no-await-in-loop -- retries are strictly sequential with a bounded backoff
			await wait(SMOKE_CHECK_RETRY_DELAY_MS)
		}
		// eslint-disable-next-line no-await-in-loop -- one request per attempt, awaited before deciding to retry
		failure = await attempt(target.url)
		if (typeof failure === 'undefined') return
		logger.warn(
			`Smoke check for "${target.service}" (${target.url}) failed on attempt ${String(tries)}/${String(SMOKE_CHECK_MAX_ATTEMPTS)}: ${failure}`,
		)
	}
	throw new Error(
		`Smoke check failed for service "${target.service}" at ${target.url} after ${String(SMOKE_CHECK_MAX_ATTEMPTS)} attempts: ${failure ?? 'unknown error'}`,
	)
}

/**
 * GET `/healthz` on every routed service after deploy, retrying each a bounded
 * number of times (a just-attached Custom Domain propagates in seconds). A
 * service still non-2xx (or unreachable) once its attempts are exhausted throws,
 * carrying the last status + truncated body so the deploy job turns red with the
 * HTTP response in the log. An empty target list is a no-op.
 */
export async function smokeCheckWorkers(
	targets: ReadonlyArray<SmokeCheckTarget>,
	options: SmokeCheckOptions = {},
): Promise<void> {
	const wait = options.sleep ?? sleep
	for (const target of targets) {
		// eslint-disable-next-line no-await-in-loop -- services checked one at a time so a failure surfaces its own service
		await smokeCheckOne(target, wait)
		logger.info(
			`Smoke check passed for "${target.service}" (${target.url})`,
		)
	}
}
