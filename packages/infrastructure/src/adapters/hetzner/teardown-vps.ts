import { createLogger } from '@nextnode-solutions/logger'

import { extractRootDomain } from '../../domain/cloudflare/dns-records.ts'
import type { ResourceOutcome } from '../../domain/deploy/resource-outcome.ts'
import { deleteDnsRecordsByName } from '../cloudflare/dns/delete-records.ts'
import type { R2Operations } from '../r2/client.types.ts'
import { deleteTailnetDevicesByHostname } from '../tailscale/oauth.ts'

import {
	deleteFirewall,
	findFirewallById,
	findFirewallsByName,
} from './api/firewall.ts'
import { deleteServer, findServerById } from './api/server.ts'
import { MAX_POLL_ATTEMPTS, POLL_INTERVAL_MS } from './constants.ts'
import { deleteState, readState } from './state/read-write.ts'
import { waitUntil } from './wait.ts'

const logger = createLogger()

export async function teardownServer(
	hcloudToken: string,
	r2: R2Operations,
	vpsName: string,
): Promise<ResourceOutcome> {
	const existing = await readState(r2, vpsName)
	if (!existing) {
		// Unreachable in normal flow: runHetznerTeardown rejects missing state
		// before we get here. Stateless cleanup is the recover command's job.
		throw new Error(
			`teardownServer for VPS "${vpsName}": no R2 state. Use the recover command for orphan cleanup.`,
		)
	}

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

export async function teardownFirewall(
	hcloudToken: string,
	vpsName: string,
): Promise<ResourceOutcome> {
	const firewallName = `${vpsName}-fw`
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
	vpsName: string,
): Promise<ResourceOutcome> {
	const purged = await deleteTailnetDevicesByHostname(
		tailscaleAuthKey,
		vpsName,
	)
	logger.info(
		`Tailscale: ${String(purged)} device(s) purged for VPS "${vpsName}"`,
	)
	return {
		handled: purged > 0,
		detail: `${String(purged)} device(s) purged`,
	}
}

/**
 * Delete every DNS record for the given hostnames. Used by VPS teardown to
 * clean up DNS for ALL projects hosted on the VPS in one shot — the list
 * of hostnames is read from the live Caddy config before the server is
 * destroyed.
 */
export async function teardownVpsDns(
	hostnames: ReadonlyArray<string>,
	cloudflareApiToken: string,
): Promise<ResourceOutcome> {
	if (hostnames.length === 0) {
		return { handled: false, detail: 'no hostnames to delete' }
	}

	const lookups = hostnames.map(name => ({
		zoneName: extractRootDomain(name),
		name,
	}))
	const deletedCount = await deleteDnsRecordsByName(
		lookups,
		cloudflareApiToken,
	)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} record(s) deleted across ${String(hostnames.length)} hostname(s)`,
	}
}

/**
 * Wipe every Caddy ACME cert object for the VPS. The whole `${vpsName}/`
 * R2 prefix is shared across all projects — at VPS teardown time every
 * project is going away, so we drop the prefix wholesale.
 */
export async function teardownVpsCerts(
	certsR2: R2Operations,
	vpsName: string,
): Promise<ResourceOutcome> {
	const prefix = `${vpsName}/`
	const deletedCount = await certsR2.deleteByPrefix(prefix)
	logger.info(
		`R2 certs purged for VPS "${vpsName}" (${String(deletedCount)} object(s))`,
	)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} cert object(s) deleted`,
	}
}

export async function teardownVpsState(
	r2: R2Operations,
	vpsName: string,
): Promise<ResourceOutcome> {
	await deleteState(r2, vpsName)
	logger.info(`R2 state deleted for VPS "${vpsName}"`)
	return { handled: true, detail: 'deleted' }
}
