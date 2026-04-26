import { createLogger } from '@nextnode-solutions/logger'

import type { OrphanVps } from '../../domain/hetzner/orphans.ts'
import type { R2Operations } from '../r2/client.types.ts'
import { deleteTailnetDevicesByHostname } from '../tailscale/oauth.ts'

import { deleteServer, findServerById } from './api/server.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { waitUntil } from './wait.ts'

const logger = createLogger()

export interface RecoverOrphanInput {
	readonly orphan: OrphanVps
	readonly hcloudToken: string
	readonly tailscaleAuthKey: string
	readonly certsR2: R2Operations
}

export interface RecoverOrphanResult {
	readonly vpsName: string
	readonly serversDeleted: ReadonlyArray<number>
	readonly tailscaleDevicesPurged: number
	readonly certObjectsDeleted: number
}

/**
 * Best-effort cleanup for an orphan VPS (no R2 state).
 *
 * Deletes:
 *  - every Hetzner server tagged with this vpsName label
 *  - every Tailscale device whose hostname matches the vpsName
 *  - every R2 cert object under `${vpsName}/`
 *
 * Does NOT touch DNS or Caddy config: with no state we can't reach the
 * server over Tailscale to enumerate Caddy upstreams. Operators must
 * clean stale DNS records manually (the monitoring UI surfaces them).
 */
export async function recoverOrphanVps(
	input: RecoverOrphanInput,
): Promise<RecoverOrphanResult> {
	const { orphan, hcloudToken, tailscaleAuthKey, certsR2 } = input

	await Promise.all(
		orphan.serverIds.map(async serverId => {
			await deleteServer(hcloudToken, serverId)
			await waitUntil({
				subject: `Server ${String(serverId)} deletion`,
				poll: () => findServerById(hcloudToken, serverId),
				isDone: server => server === null,
				detail: server => `status=${server?.status ?? 'unknown'}`,
				maxAttempts: MAX_POLL_ATTEMPTS,
				intervalMs: POLL_INTERVAL_MS,
			})
		}),
	)

	const tailscaleDevicesPurged = await deleteTailnetDevicesByHostname(
		tailscaleAuthKey,
		orphan.vpsName,
	)

	const certObjectsDeleted = await certsR2.deleteByPrefix(
		`${orphan.vpsName}/`,
	)

	logger.info(
		`Recovered orphan VPS "${orphan.vpsName}": servers=[${orphan.serverIds.join(', ')}] tailscale=${String(tailscaleDevicesPurged)} certs=${String(certObjectsDeleted)}`,
	)

	return {
		vpsName: orphan.vpsName,
		serversDeleted: orphan.serverIds,
		tailscaleDevicesPurged,
		certObjectsDeleted,
	}
}
