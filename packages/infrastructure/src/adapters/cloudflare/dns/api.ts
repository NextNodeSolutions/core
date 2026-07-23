import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	cfFetchJson,
	requireArrayResult,
	requireObjectResult,
	requireOk,
} from '#/adapters/cloudflare/api.ts'

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

function parseZoneId(rawEntry: unknown): string {
	if (typeof rawEntry !== 'object' || rawEntry === null) {
		throw new Error('Cloudflare zone lookup: zone is not an object')
	}
	if (!('id' in rawEntry) || typeof rawEntry.id !== 'string') {
		throw new Error('Cloudflare zone lookup: zone.id missing')
	}
	return rawEntry.id
}

function parseDnsRecord(rawEntry: unknown): CloudflareDnsRecord {
	if (typeof rawEntry !== 'object' || rawEntry === null) {
		throw new Error('Cloudflare DNS record: item is not an object')
	}
	if (!('id' in rawEntry) || typeof rawEntry.id !== 'string') {
		throw new Error('Cloudflare DNS record: id missing')
	}
	if (!('type' in rawEntry) || typeof rawEntry.type !== 'string') {
		throw new Error('Cloudflare DNS record: type missing')
	}
	if (!('name' in rawEntry) || typeof rawEntry.name !== 'string') {
		throw new Error('Cloudflare DNS record: name missing')
	}
	if (!('content' in rawEntry) || typeof rawEntry.content !== 'string') {
		throw new Error('Cloudflare DNS record: content missing')
	}
	if (!('proxied' in rawEntry) || typeof rawEntry.proxied !== 'boolean') {
		throw new Error('Cloudflare DNS record: proxied missing')
	}
	if (!('ttl' in rawEntry) || typeof rawEntry.ttl !== 'number') {
		throw new Error('Cloudflare DNS record: ttl missing')
	}
	return {
		id: rawEntry.id,
		type: rawEntry.type,
		name: rawEntry.name,
		content: rawEntry.content,
		proxied: rawEntry.proxied,
		ttl: rawEntry.ttl,
	}
}

export async function lookupZoneId(
	zoneName: string,
	token: string,
): Promise<string> {
	const context = `Cloudflare zone lookup for "${zoneName}"`
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones?name=${encodeURIComponent(zoneName)}`,
		token,
		context,
	)

	const zones = requireArrayResult(responseBody, context)
	if (!zones.length) {
		throw new Error(
			`Cloudflare zone not found for "${zoneName}" - ensure the zone exists in this account and the API token has Zone:Read access`,
		)
	}
	return parseZoneId(zones[0])
}

export async function listDnsRecords(
	zoneId: string,
	name: string,
	token: string,
): Promise<ReadonlyArray<CloudflareDnsRecord>> {
	const params = new URLSearchParams({ name })
	const context = `Cloudflare DNS list for ${name}`
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records?${params.toString()}`,
		token,
		context,
	)
	return requireArrayResult(responseBody, context).map(parseDnsRecord)
}

export async function createDnsRecord(
	zoneId: string,
	payload: DnsRecordPayload,
	token: string,
): Promise<CloudflareDnsRecord> {
	const context = `Cloudflare DNS create for ${payload.name}`
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records`,
		token,
		context,
		{ method: 'POST', body: JSON.stringify(payload) },
	)
	return parseDnsRecord(requireObjectResult(responseBody, context))
}

export async function updateDnsRecord(
	zoneId: string,
	recordId: string,
	payload: DnsRecordPayload,
	token: string,
): Promise<CloudflareDnsRecord> {
	const context = `Cloudflare DNS update for ${payload.name}`
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/dns_records/${recordId}`,
		token,
		context,
		{ method: 'PUT', body: JSON.stringify(payload) },
	)
	return parseDnsRecord(requireObjectResult(responseBody, context))
}

export async function getZoneSslMode(
	zoneId: string,
	token: string,
): Promise<string> {
	const context = `Cloudflare SSL mode for zone ${zoneId}`
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/zones/${zoneId}/settings/ssl`,
		token,
		context,
	)

	const sslSetting = requireObjectResult(responseBody, context)
	if (!('value' in sslSetting) || typeof sslSetting.value !== 'string') {
		throw new Error(`${context}: missing or invalid "value" field`)
	}
	return sslSetting.value
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
