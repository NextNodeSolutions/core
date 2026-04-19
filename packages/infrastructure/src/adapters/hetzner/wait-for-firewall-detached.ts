import { findFirewallById } from './api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { pollUntil } from './polling.ts'

/**
 * Hetzner propagates firewall detachment asynchronously: the `applied_to`
 * list on a firewall keeps the attached server even briefly after that
 * server's DELETE has returned 204. Calling DELETE on the firewall during
 * that window returns 422 `resource_in_use`. Poll until the list is empty
 * (or the firewall is already gone).
 */
export async function waitForFirewallDetached(
	token: string,
	firewallId: number,
): Promise<void> {
	await pollUntil(
		{ maxAttempts: MAX_POLL_ATTEMPTS, intervalMs: POLL_INTERVAL_MS },
		() => findFirewallById(token, firewallId),
		firewall => firewall === null || firewall.appliedToCount === 0,
		{
			success: firewall =>
				firewall === null
					? `Firewall ${String(firewallId)} already gone`
					: `Firewall ${String(firewallId)} detached from all resources`,
			progress: (firewall, attempt, max) =>
				`Firewall ${String(firewallId)} still applied to ${String(
					firewall?.appliedToCount ?? 0,
				)} resource(s) (attempt ${String(attempt)}/${String(max)})`,
			timeout: max =>
				`Firewall ${String(firewallId)} still applied to resources after ${String(max)} attempts`,
		},
	)
}
