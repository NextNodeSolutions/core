import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { describeServer } from './hcloud-client.ts'

const logger = createLogger()

export async function waitForServerRunning(
	token: string,
	serverId: number,
): Promise<void> {
	for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
		const server = await describeServer(token, serverId)
		if (server.status === 'running') {
			logger.info(`Server ${serverId} is running`)
			return
		}
		logger.info(
			`Server ${serverId} status: ${server.status} (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`,
		)
		// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
		await sleep(POLL_INTERVAL_MS)
	}

	throw new Error(
		`Server ${serverId} did not reach "running" after ${MAX_POLL_ATTEMPTS} attempts`,
	)
}
