import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { findServerById } from './api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'

const logger = createLogger()

export async function waitForServerDeleted(
	token: string,
	serverId: number,
): Promise<void> {
	for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
		const server = await findServerById(token, serverId)
		if (server === null) {
			logger.info(`Server ${serverId} fully deleted`)
			return
		}
		logger.info(
			`Server ${serverId} still present (status=${server.status}, attempt ${attempt}/${MAX_POLL_ATTEMPTS})`,
		)
		if (attempt < MAX_POLL_ATTEMPTS) {
			// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
			await sleep(POLL_INTERVAL_MS)
		}
	}

	throw new Error(
		`Server ${serverId} still present after ${MAX_POLL_ATTEMPTS} attempts`,
	)
}
