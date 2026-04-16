import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { MAX_SSH_ATTEMPTS, SSH_RETRY_INTERVAL_MS } from './constants.ts'
import { createSshSession } from './ssh-session.ts'

const logger = createLogger()

export interface WaitForSshInput {
	readonly host: string
	readonly privateKey: string
}

export async function waitForSsh(input: WaitForSshInput): Promise<void> {
	for (let attempt = 1; attempt <= MAX_SSH_ATTEMPTS; attempt++) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- sequential retry by design
			const session = await createSshSession({
				host: input.host,
				username: 'root',
				privateKey: input.privateKey,
			})
			session.close()
			logger.info(`SSH reachable at ${input.host}`)
			return
		} catch {
			logger.info(
				`SSH not ready at ${input.host} (attempt ${attempt}/${MAX_SSH_ATTEMPTS})`,
			)
			// oxlint-disable-next-line no-await-in-loop -- sequential retry by design
			await sleep(SSH_RETRY_INTERVAL_MS)
		}
	}

	throw new Error(
		`SSH to ${input.host} not reachable after ${MAX_SSH_ATTEMPTS} attempts`,
	)
}
