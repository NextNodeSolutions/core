import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '../../domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { computeVpsDnsLookups } from '../../domain/hetzner/dns-records.ts'
import { deleteDnsRecordsByName } from '../cloudflare/dns/delete-records.ts'
import type { R2Operations } from '../r2/client.types.ts'
import { deleteTailnetDevicesByHostname } from '../tailscale/oauth.ts'

import {
	deleteFirewall,
	deleteServer,
	findFirewallById,
	findFirewallsByName,
	findServerById,
	findServersByLabels,
} from './api/client.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { deleteState, readState } from './state/read-write.ts'
import { waitUntil } from './wait.ts'

const logger = createLogger()

export async function teardownServer(
	hcloudToken: string,
	r2: R2Operations,
	projectName: string,
): Promise<ResourceOutcome> {
	const existing = await readState(r2, projectName)

	if (existing) {
		const { serverId } = existing.state
		await deleteServer(hcloudToken, serverId)
		await waitUntil({
			subject: `Server ${String(serverId)} deletion`,
			poll: () => findServerById(hcloudToken, serverId),
			isDone: server => server === null,
			detail: server => `status=${server?.status ?? 'unknown'}`,
			maxAttempts: MAX_POLL_ATTEMPTS,
			intervalMs: POLL_INTERVAL_MS,
		})
		return {
			handled: true,
			detail: `deleted #${String(serverId)}`,
		}
	}

	const orphans = await findServersByLabels(hcloudToken, {
		project: projectName,
		managed_by: 'nextnode',
	})
	if (orphans.length === 0) {
		return { handled: false, detail: 'already gone' }
	}

	await Promise.all(
		orphans.map(async s => {
			await deleteServer(hcloudToken, s.id)
			await waitUntil({
				subject: `Server ${String(s.id)} deletion`,
				poll: () => findServerById(hcloudToken, s.id),
				isDone: server => server === null,
				detail: server => `status=${server?.status ?? 'unknown'}`,
				maxAttempts: MAX_POLL_ATTEMPTS,
				intervalMs: POLL_INTERVAL_MS,
			})
		}),
	)
	const ids = orphans.map(s => String(s.id)).join(', ')
	logger.info(`Orphan server(s) deleted: ${ids}`)
	return { handled: true, detail: `deleted orphan(s) #${ids}` }
}

export async function teardownFirewall(
	hcloudToken: string,
	projectName: string,
): Promise<ResourceOutcome> {
	const firewallName = `${projectName}-fw`
	const firewalls = await findFirewallsByName(hcloudToken, firewallName)
	if (firewalls.length === 0) {
		return { handled: false, detail: 'not found' }
	}

	await Promise.all(
		firewalls.map(async fw => {
			await waitUntil({
				subject: `Firewall ${String(fw.id)} detachment`,
				poll: () => findFirewallById(hcloudToken, fw.id),
				isDone: firewall =>
					firewall === null || firewall.appliedToCount === 0,
				detail: firewall =>
					firewall === null
						? 'already gone'
						: `applied to ${String(firewall.appliedToCount)} resource(s)`,
				maxAttempts: MAX_POLL_ATTEMPTS,
				intervalMs: POLL_INTERVAL_MS,
			})
			await deleteFirewall(hcloudToken, fw.id)
		}),
	)
	logger.info(`Firewall "${firewallName}" deleted`)
	return { handled: true, detail: 'deleted' }
}

export async function teardownTailscale(
	tailscaleAuthKey: string,
	projectName: string,
): Promise<ResourceOutcome> {
	const purged = await deleteTailnetDevicesByHostname(
		tailscaleAuthKey,
		projectName,
	)
	logger.info(
		`Tailscale: ${String(purged)} device(s) purged for "${projectName}"`,
	)
	return {
		handled: purged > 0,
		detail: `${String(purged)} device(s) purged`,
	}
}

export async function teardownVpsDns(
	domain: string | undefined,
	environment: AppEnvironment,
	cloudflareApiToken: string,
): Promise<ResourceOutcome> {
	if (!domain) {
		return { handled: false, detail: 'no domain configured' }
	}

	const lookups = computeVpsDnsLookups({ domain, environment })
	const deletedCount = await deleteDnsRecordsByName(
		lookups,
		cloudflareApiToken,
	)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} record(s) deleted`,
	}
}

export async function teardownVpsState(
	r2: R2Operations,
	projectName: string,
): Promise<ResourceOutcome> {
	await deleteState(r2, projectName)
	logger.info(`R2 state deleted for "${projectName}"`)
	return { handled: true, detail: 'deleted' }
}
