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

export const listZones = async (
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
