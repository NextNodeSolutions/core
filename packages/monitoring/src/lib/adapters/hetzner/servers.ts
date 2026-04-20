import { hetznerGet } from '@/lib/adapters/hetzner/client.ts'
import { parseVpsStatus } from '@/lib/domain/hetzner/vps.ts'
import type { HetznerVps } from '@/lib/domain/hetzner/vps.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

// Public IPv4 is optional in the Hetzner API (servers can be IPv6-only or
// private-net-only), so `null` is a domain value, not a silent fallback.
const parseIpv4 = (publicNet: unknown): string | null => {
	if (!isRecord(publicNet)) return null
	const ipv4 = publicNet.ipv4
	if (!isRecord(ipv4)) return null
	return typeof ipv4.ip === 'string' ? ipv4.ip : null
}

// `labels` is an optional map in the Hetzner API — absent means "no labels".
const parseLabels = (
	raw: unknown,
	context: string,
): Readonly<Record<string, string>> => {
	if (raw === undefined || raw === null) return {}
	if (!isRecord(raw)) {
		throw new Error(`${context}: \`labels\` must be an object`)
	}
	const labels: Record<string, string> = {}
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === 'string') labels[key] = value
	}
	return labels
}

const parseServerType = (raw: unknown, context: string): string => {
	if (!isRecord(raw) || typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`server_type.name\``)
	}
	return raw.name
}

const parseLocation = (datacenter: unknown, context: string): string => {
	if (!isRecord(datacenter)) {
		throw new Error(`${context}: missing \`datacenter\``)
	}
	const location = datacenter.location
	if (!isRecord(location) || typeof location.name !== 'string') {
		throw new Error(`${context}: missing \`datacenter.location.name\``)
	}
	return location.name
}

const parseServer = (raw: unknown, index: number): HetznerVps => {
	const context = `Hetzner server[${String(index)}]`
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.id !== 'number') {
		throw new Error(`${context}: missing \`id\``)
	}
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`name\``)
	}
	if (typeof raw.status !== 'string') {
		throw new Error(`${context}: missing \`status\``)
	}
	if (typeof raw.created !== 'string') {
		throw new Error(`${context}: missing \`created\``)
	}
	return {
		id: raw.id,
		name: raw.name,
		status: parseVpsStatus(raw.status),
		ipv4: parseIpv4(raw.public_net),
		serverType: parseServerType(raw.server_type, context),
		location: parseLocation(raw.datacenter, context),
		createdAt: raw.created,
		labels: parseLabels(raw.labels, context),
	}
}

/**
 * List every Hetzner server reachable by the given token.
 *
 * Not paginated — NextNode's project fleet is a handful of VPSs, well
 * under the Hetzner default per-page cap. If the fleet grows past one
 * page, switch to iterating `meta.pagination.next_page`.
 */
export const listServers = async (
	token: string,
): Promise<ReadonlyArray<HetznerVps>> => {
	const context = 'Hetzner servers list'
	const data = await hetznerGet('/servers', token, context)
	if (!isRecord(data) || !Array.isArray(data.servers)) {
		throw new Error(`${context}: missing \`servers\` array`)
	}
	return data.servers.map(parseServer)
}
