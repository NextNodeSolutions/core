import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	cfFetchJson,
	requireArrayResult,
	requireObjectResult,
	requireOk,
} from '@/adapters/cloudflare/api.ts'

export interface CloudflareDnsRecord {
	readonly id: string
	readonly type: string
	readonly name: string
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

export interface DnsRecordPayload {
	readonly type: string
	readonly name: string
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

function parseZoneId(item: unknown): string {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare zone lookup: zone is not an object')
	}
	if (!('id' in item) || typeof item.id !== 'string') {
		throw new Error('Cloudflare zone lookup: zone.id missing')
	}
	return item.id
}

function parseDnsRecord(item: unknown): CloudflareDnsRecord {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare DNS record: item is not an object')
	}
	if (!('id' in item) || typeof item.id !== 'string') {
		throw new Error('Cloudflare DNS record: id missing')
	}
	if (!('type' in item) || typeof item.type !== 'string') {
		throw new Error('Cloudflare DNS record: type missing')
	}
	if (!('name' in item) || typeof item.name !== 'string') {
		throw new Error('Cloudflare DNS record: name missing')
	}
	if (!('content' in item) || typeof item.content !== 'string') {
		throw new Error('Cloudflare DNS record: content missing')
	}
	if (!('proxied' in item) || typeof item.proxied !== 'boolean') {
		throw new Error('Cloudflare DNS record: proxied missing')
	}
	if (!('ttl' in item) || typeof item.ttl !== 'number') {
		throw new Error('Cloudflare DNS record: ttl missing')
	}
	return {
		id: item.id,
		type: item.type,
		name: item.name,
		content: item.content,
		proxied: item.proxied,
		ttl: item.ttl,
	}
}

export async function lookupZoneId(
	zoneName: string,
	token: string,
): Promise<string> {
	const context = `Cloudflare zone lookup for "${zoneName}"`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(zoneName)}`,
		token,
		context,
	)

	const result = requireArrayResult(data, context)
	if (result.length === 0) {
		throw new Error(
			`Cloudflare zone not found for "${zoneName}" — ensure the zone exists in this account and the API token has Zone:Read access`,
		)
	}
	return parseZoneId(result[0])
}

export async function listDnsRecords(
	zoneId: string,
	name: string,
	token: string,
): Promise<ReadonlyArray<CloudflareDnsRecord>> {
	const params = new URLSearchParams({ name })
	const context = `Cloudflare DNS list for ${name}`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?${params.toString()}`,
		token,
		context,
	)
	return requireArrayResult(data, context).map(parseDnsRecord)
}

export async function createDnsRecord(
	zoneId: string,
	payload: DnsRecordPayload,
	token: string,
): Promise<CloudflareDnsRecord> {
	const context = `Cloudflare DNS create for ${payload.name}`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`,
		token,
		context,
		{ method: 'POST', body: JSON.stringify(payload) },
	)
	return parseDnsRecord(requireObjectResult(data, context))
}

export async function updateDnsRecord(
	zoneId: string,
	recordId: string,
	payload: DnsRecordPayload,
	token: string,
): Promise<CloudflareDnsRecord> {
	const context = `Cloudflare DNS update for ${payload.name}`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
		token,
		context,
		{ method: 'PUT', body: JSON.stringify(payload) },
	)
	return parseDnsRecord(requireObjectResult(data, context))
}

export async function getZoneSslMode(
	zoneId: string,
	token: string,
): Promise<string> {
	const context = `Cloudflare SSL mode for zone ${zoneId}`
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/settings/ssl`,
		token,
		context,
	)

	const result = requireObjectResult(data, context)
	if (!('value' in result) || typeof result.value !== 'string') {
		throw new Error(`${context}: missing or invalid "value" field`)
	}
	return result.value
}

export async function setZoneSslMode(
	zoneId: string,
	mode: string,
	token: string,
): Promise<void> {
	await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/settings/ssl`,
		token,
		`Cloudflare set SSL mode for zone ${zoneId}`,
		{ method: 'PATCH', body: JSON.stringify({ value: mode }) },
	)
}

export async function deleteDnsRecord(
	zoneId: string,
	recordId: string,
	token: string,
): Promise<void> {
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
		{
			method: 'DELETE',
			headers: authHeaders(token),
		},
	)
	await requireOk(response)
}
