import { findServerById } from './api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { pollUntil } from './polling.ts'

export async function waitForServerDeleted(
	token: string,
	serverId: number,
): Promise<void> {
	await pollUntil({
		subject: `Server ${String(serverId)} deletion`,
		poll: () => findServerById(token, serverId),
		isDone: server => server === null,
		detail: server => `status=${server?.status ?? 'unknown'}`,
		maxAttempts: MAX_POLL_ATTEMPTS,
		intervalMs: POLL_INTERVAL_MS,
	})
}
