import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { findFirewallById } from './api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'

const logger = createLogger()

// Hetzner propagates firewall detachment asynchronously: applied_to can
// briefly still list a server after that server's DELETE returned 204.
// Deleting the firewall in that window returns 422 resource_in_use.
export async function waitForFirewallDetached(
	token: string,
	firewallId: number,
): Promise<void> {
	for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
		const firewall = await findFirewallById(token, firewallId)
		if (firewall === null) {
			logger.info(`Firewall ${firewallId} already gone`)
			return
		}
		if (firewall.appliedToCount === 0) {
			logger.info(`Firewall ${firewallId} detached from all resources`)
			return
		}
		logger.info(
			`Firewall ${firewallId} still applied to ${firewall.appliedToCount} resource(s) (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`,
		)
		if (attempt < MAX_POLL_ATTEMPTS) {
			// oxlint-disable-next-line no-await-in-loop -- sequential polling by design
			await sleep(POLL_INTERVAL_MS)
		}
	}

	throw new Error(
		`Firewall ${firewallId} still applied to resources after ${MAX_POLL_ATTEMPTS} attempts`,
	)
}
