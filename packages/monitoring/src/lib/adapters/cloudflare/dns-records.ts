import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { listAll } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareDnsRecord } from '@/lib/domain/cloudflare/dns-record.ts'
import { parseDnsRecordType } from '@/lib/domain/cloudflare/dns-record.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

// /zones/:id/dns_records accepts per_page up to 100 (default 100). Larger
// values return error 1004. Used as the chunk size for auto-pagination.
const DNS_RECORDS_MAX_PER_PAGE = 100

const parseDnsRecord = (
	raw: unknown,
	index: number,
	zoneName: string,
): CloudflareDnsRecord => {
	const context = `Cloudflare DNS record[${String(index)}] (zone "${zoneName}")`
	if (!isRecord(raw)) throw new Error(`${context}: not an object`)
	if (typeof raw.id !== 'string') {
		throw new Error(`${context}: missing \`id\``)
	}
	if (typeof raw.zone_id !== 'string') {
		throw new Error(`${context}: missing \`zone_id\``)
	}
	if (typeof raw.name !== 'string') {
		throw new Error(`${context}: missing \`name\``)
	}
	if (typeof raw.content !== 'string') {
		throw new Error(`${context}: missing \`content\``)
	}
	const ttl = typeof raw.ttl === 'number' ? raw.ttl : 0
	return {
		id: raw.id,
		zoneId: raw.zone_id,
		zoneName,
		name: raw.name,
		type: parseDnsRecordType(raw.type),
		content: raw.content,
		proxied: raw.proxied === true,
		ttl,
		comment: parseStringOrNull(raw.comment),
	}
}

export interface ListDnsRecordsByContentOptions {
	readonly client: CloudflareClient
	readonly zoneId: string
	readonly zoneName: string
	readonly content: string
}

// DNS records can change but rarely faster than a minute — operator-driven
// edits are confirm-gated and not the common navigation case.
const DNS_RECORDS_TTL_MS = 60_000

const fetchDnsRecordsByContent = async ({
	client,
	zoneId,
	zoneName,
	content,
}: ListDnsRecordsByContentOptions): Promise<
	ReadonlyArray<CloudflareDnsRecord>
> => {
	const context = `Cloudflare DNS records for zone "${zoneName}" content="${content}"`
	const raw = await listAll(
		`/zones/${zoneId}/dns_records?content=${encodeURIComponent(content)}`,
		client.token,
		context,
		DNS_RECORDS_MAX_PER_PAGE,
	)
	return raw.map((item, index) => parseDnsRecord(item, index, zoneName))
}

const memoizedListDnsRecordsByContent = keyedMemoizeAsync(
	DNS_RECORDS_TTL_MS,
	({ zoneId, content }: ListDnsRecordsByContentOptions) =>
		`${zoneId} ${content}`,
	fetchDnsRecordsByContent,
)

export const listDnsRecordsByContent = (
	options: ListDnsRecordsByContentOptions,
): Promise<ReadonlyArray<CloudflareDnsRecord>> =>
	memoizedListDnsRecordsByContent(options)
