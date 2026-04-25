import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import {
	MAX_SSH_ATTEMPTS,
	SSH_RETRY_INTERVAL_MS,
} from '@/adapters/hetzner/constants.ts'
import { createSshSession } from '@/adapters/hetzner/ssh/session.ts'

const logger = createLogger()

export interface WaitForSshInput {
	readonly host: string
	readonly privateKey: string
}

export interface WaitForSshResult {
	readonly hostKeyFingerprint: string
}

export async function waitForSsh(
	input: WaitForSshInput,
): Promise<WaitForSshResult> {
	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_SSH_ATTEMPTS; attempt++) {
		try {
			// oxlint-disable-next-line no-await-in-loop -- sequential retry by design
			const session = await createSshSession({
				host: input.host,
				username: 'deploy',
				privateKey: input.privateKey,
			})
			const { hostKeyFingerprint } = session
			session.close()
			logger.info(`SSH reachable at ${input.host}`)
			return { hostKeyFingerprint }
		} catch (err) {
			lastError = err
			const message = err instanceof Error ? err.message : String(err)
			logger.info(
				`SSH not ready at ${input.host} (attempt ${attempt}/${MAX_SSH_ATTEMPTS}): ${message}`,
			)
			// oxlint-disable-next-line no-await-in-loop -- sequential retry by design
			await sleep(SSH_RETRY_INTERVAL_MS)
		}
	}

	throw new Error(
		`SSH to ${input.host} not reachable after ${MAX_SSH_ATTEMPTS} attempts`,
		{ cause: lastError },
	)
}
