import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { listAll } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareZone } from '@/lib/domain/cloudflare/zone.ts'
import { parseCloudflareZoneStatus } from '@/lib/domain/cloudflare/zone.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

// /zones accepts per_page up to 50 (default 20). Larger values return error
// 1004 ("DNS Validation Error"). Used as the chunk size for auto-pagination.
const ZONES_MAX_PER_PAGE = 50

const parseZone = (raw: unknown, index: number): CloudflareZone => {
	const context = `Cloudflare zone[${String(index)}]`
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.id !== 'string') {
		throw new Error(`${context}: missing \`id\``)
	}
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`name\``)
	}
	return {
		id: raw.id,
		name: raw.name,
		status: parseCloudflareZoneStatus(raw.status),
	}
}

// Zones change very rarely — adding a new zone is a manual operator step. A
// 5 min TTL is plenty fresh and removes most of the per-page-render fan-out.
const ZONES_TTL_MS = 300_000

const fetchZones = async (
	client: CloudflareClient,
): Promise<ReadonlyArray<CloudflareZone>> => {
	const context = `Cloudflare zones list (account ${client.accountId})`
	const raw = await listAll(
		`/zones?account.id=${encodeURIComponent(client.accountId)}`,
		client.token,
		context,
		ZONES_MAX_PER_PAGE,
	)
	return raw.map(parseZone)
}

const memoizedListZones = keyedMemoizeAsync(
	ZONES_TTL_MS,
	(client: CloudflareClient) => client.accountId,
	fetchZones,
)

export const listZones = (
	client: CloudflareClient,
): Promise<ReadonlyArray<CloudflareZone>> => memoizedListZones(client)
