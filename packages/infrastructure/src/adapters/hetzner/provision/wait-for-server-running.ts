import { describeServer } from '../api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from '../constants.ts'
import { pollUntil } from '../polling.ts'

export async function waitForServerRunning(
	token: string,
	serverId: number,
): Promise<void> {
	await pollUntil({
		subject: `Server ${String(serverId)} startup`,
		poll: () => describeServer(token, serverId),
		isDone: server => server.status === 'running',
		detail: server => `status=${server.status}`,
		maxAttempts: MAX_POLL_ATTEMPTS,
		intervalMs: POLL_INTERVAL_MS,
	})
}
