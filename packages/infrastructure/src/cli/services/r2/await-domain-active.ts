import { setTimeout as sleep } from 'node:timers/promises'

import { getR2CustomDomainStatus } from '#/adapters/cloudflare/r2/domains.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const POLL_MAX_ATTEMPTS = 20
const POLL_INTERVAL_MS = 5_000
const SSL_ACTIVE = 'active'

export interface AwaitR2DomainActiveInput {
	readonly token: string
	readonly accountId: string
	readonly bucketName: string
	readonly domain: string
}

/**
 * Poll a custom domain's status until its SSL certificate is active.
 * Cloudflare issues the cert asynchronously after attach, so the domain
 * 404s/TLS-errors for a few minutes. Fails loud once the budget is spent
 * rather than writing state that points at a not-yet-serving URL.
 */
export async function awaitR2DomainActive(
	input: AwaitR2DomainActiveInput,
): Promise<void> {
	for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- sequential polling by design
		const status = await getR2CustomDomainStatus(
			input.token,
			input.accountId,
			input.bucketName,
			input.domain,
		)
		if (status.ssl === SSL_ACTIVE) return
		logger.info(
			`R2 custom domain "${input.domain}" not yet active (attempt ${String(attempt)}/${String(POLL_MAX_ATTEMPTS)}, ownership=${status.ownership}, ssl=${status.ssl})`,
		)
		await sleep(POLL_INTERVAL_MS) // eslint-disable-line no-await-in-loop -- sequential polling by design
	}
	throw new Error(
		`R2 custom domain "${input.domain}" did not become active after ${String(POLL_MAX_ATTEMPTS)} attempts`,
	)
}
