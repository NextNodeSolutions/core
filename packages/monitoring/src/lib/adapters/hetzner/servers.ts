import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { hetznerGet } from '@/lib/adapters/hetzner/client.ts'
import {
	parseVpsArchitecture,
	parseVpsCpuType,
	parseVpsStatus,
} from '@/lib/domain/hetzner/vps.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import {
	parseFiniteNumber,
	requireFiniteNumber,
} from '@/lib/domain/parse-number.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

import type {
	HetznerVps,
	HetznerVpsLocation,
	HetznerVpsProtection,
	HetznerVpsServerType,
	HetznerVpsTraffic,
} from '@/lib/domain/hetzner/vps.ts'

// Public IPv4 is optional in the Hetzner API (servers can be IPv6-only or
// private-net-only), so `null` is a domain value, not a silent fallback.
const parseIpv4 = (publicNet: unknown): string | null => {
	if (!isRecord(publicNet)) return null
	const ipv4 = publicNet.ipv4
	if (!isRecord(ipv4)) return null
	return typeof ipv4.ip === 'string' ? ipv4.ip : null
}

const parseIpv6 = (publicNet: unknown): string | null => {
	if (!isRecord(publicNet)) return null
	const ipv6 = publicNet.ipv6
	if (!isRecord(ipv6)) return null
	return typeof ipv6.ip === 'string' ? ipv6.ip : null
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

const parseServerType = (
	raw: unknown,
	context: string,
): HetznerVpsServerType => {
	if (!isRecord(raw)) {
		throw new Error(`${context}: missing \`server_type\``)
	}
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`server_type.name\``)
	}
	return {
		name: raw.name,
		description: parseStringOrNull(raw.description) ?? raw.name,
		cores: requireFiniteNumber(raw.cores, 'server_type.cores', context),
		memoryGb: requireFiniteNumber(
			raw.memory,
			'server_type.memory',
			context,
		),
		diskGb: requireFiniteNumber(raw.disk, 'server_type.disk', context),
		cpuType: parseVpsCpuType(raw.cpu_type),
		architecture: parseVpsArchitecture(raw.architecture),
	}
}

const parseLocation = (
	datacenter: unknown,
	context: string,
): HetznerVpsLocation => {
	if (!isRecord(datacenter)) {
		throw new Error(`${context}: missing \`datacenter\``)
	}
	const location = datacenter.location
	if (!isRecord(location) || typeof location.name !== 'string') {
		throw new Error(`${context}: missing \`datacenter.location.name\``)
	}
	return {
		name: location.name,
		city: parseStringOrNull(location.city),
		country: parseStringOrNull(location.country),
		datacenter: parseStringOrNull(datacenter.name),
	}
}

const parseImage = (raw: unknown): string | null => {
	if (!isRecord(raw)) return null
	return parseStringOrNull(raw.description) ?? parseStringOrNull(raw.name)
}

const parseTraffic = (raw: unknown): HetznerVpsTraffic => {
	if (!isRecord(raw)) {
		return { ingoingBytes: 0, outgoingBytes: 0, includedBytes: 0 }
	}
	return {
		ingoingBytes: parseFiniteNumber(raw.ingoing_traffic) ?? 0,
		outgoingBytes: parseFiniteNumber(raw.outgoing_traffic) ?? 0,
		includedBytes: parseFiniteNumber(raw.included_traffic) ?? 0,
	}
}

const parseProtection = (raw: unknown): HetznerVpsProtection => {
	if (!isRecord(raw)) return { delete: false, rebuild: false }
	return {
		delete: raw.delete === true,
		rebuild: raw.rebuild === true,
	}
}

const parseVolumeCount = (raw: unknown): number =>
	Array.isArray(raw) ? raw.length : 0

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
		ipv6: parseIpv6(raw.public_net),
		serverType: parseServerType(raw.server_type, context),
		location: parseLocation(raw.datacenter, context),
		image: parseImage(raw.image),
		createdAt: raw.created,
		labels: parseLabels(raw.labels, context),
		traffic: parseTraffic(raw),
		protection: parseProtection(raw.protection),
		backupsEnabled:
			typeof raw.backup_window === 'string' &&
			raw.backup_window.length > 0,
		locked: raw.locked === true,
		volumeCount: parseVolumeCount(raw.volumes),
	}
}

const parseServerList = (
	data: unknown,
	context: string,
): ReadonlyArray<HetznerVps> => {
	if (!isRecord(data) || !Array.isArray(data.servers)) {
		throw new Error(`${context}: missing \`servers\` array`)
	}
	return data.servers.map(parseServer)
}

// VPS state changes rarely (create/destroy/reboot are operator-driven and
// confirm-gated). 30 s strikes the balance between snappy navigation and
// the operator seeing a freshly-destroyed server disappear soon after.
const SERVER_LIST_TTL_MS = 30_000
const SERVER_BY_NAME_TTL_MS = 30_000

/**
 * List every Hetzner server reachable by the given token.
 *
 * Not paginated — NextNode's project fleet is a handful of VPSs, well
 * under the Hetzner default per-page cap. If the fleet grows past one
 * page, switch to iterating `meta.pagination.next_page`.
 */
const fetchServerList = async (
	token: string,
): Promise<ReadonlyArray<HetznerVps>> => {
	const context = 'Hetzner servers list'
	const data = await hetznerGet('/servers', token, context)
	return parseServerList(data, context)
}

const memoizedListServers = keyedMemoizeAsync(
	SERVER_LIST_TTL_MS,
	(token: string) => token,
	fetchServerList,
)

export const listServers = (
	token: string,
): Promise<ReadonlyArray<HetznerVps>> => memoizedListServers(token)

/**
 * Fetch a single Hetzner server by name.
 *
 * Hetzner has no `/servers/by-name/{name}` route — the canonical lookup is
 * `/servers?name=<name>`, which returns a list filtered server-side. Names
 * are unique within a project, so we expect zero or one match.
 */
const fetchServerByName = async (args: {
	token: string
	name: string
}): Promise<HetznerVps | null> => {
	const context = `Hetzner server "${args.name}"`
	const data = await hetznerGet(
		`/servers?name=${encodeURIComponent(args.name)}`,
		args.token,
		context,
	)
	const servers = parseServerList(data, context)
	return servers[0] ?? null
}

const memoizedGetServerByName = keyedMemoizeAsync(
	SERVER_BY_NAME_TTL_MS,
	(args: { token: string; name: string }) => `${args.token} ${args.name}`,
	fetchServerByName,
)

export const getServerByName = (
	token: string,
	name: string,
): Promise<HetznerVps | null> => memoizedGetServerByName({ token, name })
