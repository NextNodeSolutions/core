import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { CONTAINER_RELEASE_HEADER } from '../../../../runtime/container-gateway/contract.ts'

import type { SmokeCheckTarget } from '#/domain/cloudflare/workers/smoke-check.ts'

const logger = createLogger()

// A freshly attached Custom Domain needs DNS + a newly issued edge certificate
// to propagate before the first request succeeds. A one-label host under the
// zone is covered by the existing Universal SSL wildcard and answers in
// seconds, but a two-label-deep host (e.g. dev.admin.example.com) needs its own
// certificate issued on demand - observed at 3-6 minutes on a first greenfield
// deploy. A container's first request also waits for its boot. The budget is
// wall-clock time shared by every service, and each request is cut at its end:
// a request that hangs cannot stretch the check past the job's timeout.
export const SMOKE_CHECK_BUDGET_MS = 600_000
export const SMOKE_CHECK_RETRY_DELAY_MS = 15_000
const SMOKE_CHECK_BODY_MAX_LENGTH = 500
const MS_PER_SECOND = 1000

export interface SmokeCheckOptions {
	// Injection point for tests; production waits with a real timer.
	readonly sleep?: ((ms: number) => Promise<void>) | undefined
}

function truncate(body: string): string {
	if (body.length <= SMOKE_CHECK_BODY_MAX_LENGTH) return body
	return `${body.slice(0, SMOKE_CHECK_BODY_MAX_LENGTH)}… (truncated)`
}

// A container's gateway names the release that served the health check: a
// 2xx from the previous release (an object the platform kept on the old
// version) is not this deploy's pass.
function releaseMismatch(
	target: SmokeCheckTarget,
	response: Response,
): string | undefined {
	if (!target.expectedRelease) return undefined
	const served = response.headers.get(CONTAINER_RELEASE_HEADER)
	if (served === target.expectedRelease) return undefined
	return `release "${served ?? 'none'}" served, expected "${target.expectedRelease}"`
}

async function attempt(
	target: SmokeCheckTarget,
	timeoutMs: number,
): Promise<string | undefined> {
	try {
		const response = await fetch(target.url, {
			method: 'GET',
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (response.ok) return releaseMismatch(target, response)
		const body = truncate(await response.text())
		return `HTTP ${String(response.status)} - ${body}`
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

function secondsLeft(deadline: number): string {
	return String(
		Math.max(0, Math.round((deadline - Date.now()) / MS_PER_SECOND)),
	)
}

async function smokeCheckOne(
	target: SmokeCheckTarget,
	deadline: number,
	wait: (ms: number) => Promise<void>,
): Promise<void> {
	let failure: string | undefined
	for (let tries = 1; Date.now() < deadline; tries += 1) {
		// eslint-disable-next-line no-await-in-loop -- one request per attempt, awaited before deciding to retry
		failure = await attempt(target, deadline - Date.now())
		if (typeof failure === 'undefined') return
		logger.warn(
			`Smoke check for "${target.service}" (${target.url}) failed on attempt ${String(tries)}, ${secondsLeft(deadline)} s left: ${failure}`,
		)
		if (deadline - Date.now() <= SMOKE_CHECK_RETRY_DELAY_MS) break
		// eslint-disable-next-line no-await-in-loop -- retries are strictly sequential with a bounded backoff
		await wait(SMOKE_CHECK_RETRY_DELAY_MS)
	}
	throw new Error(
		`Smoke check failed for service "${target.service}" at ${target.url}: no 2xx${target.expectedRelease ? ` of release "${target.expectedRelease}"` : ''} within ${String(SMOKE_CHECK_BUDGET_MS / MS_PER_SECOND)} s of the deploy. Last failure: ${failure ?? 'the deadline passed before its first attempt'}`,
	)
}

/**
 * GET `/healthz` on every routed service after deploy, retrying until one
 * shared deadline (a just-attached Custom Domain propagates in seconds). A
 * container service must also answer with this deploy's release. A service
 * still failing (or unreachable) at the deadline throws, carrying the last
 * status + truncated body so the deploy job turns red with the HTTP response
 * in the log. An empty target list is a no-op.
 */
export async function smokeCheckWorkers(
	targets: ReadonlyArray<SmokeCheckTarget>,
	options: SmokeCheckOptions = {},
): Promise<void> {
	const wait = options.sleep ?? sleep
	const deadline = Date.now() + SMOKE_CHECK_BUDGET_MS
	for (const target of targets) {
		// eslint-disable-next-line no-await-in-loop -- services checked one at a time so a failure surfaces its own service
		await smokeCheckOne(target, deadline, wait)
		logger.info(
			`Smoke check passed for "${target.service}" (${target.url})`,
		)
	}
}
