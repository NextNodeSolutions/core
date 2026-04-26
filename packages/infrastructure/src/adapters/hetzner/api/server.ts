import { isRecord } from '#/config/types.ts'
import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'

import {
	HCLOUD_API_BASE,
	authHeaders,
	formatLabelSelector,
	requireOk,
} from './base.ts'

export interface HcloudServerResponse {
	readonly id: number
	readonly name: string
	readonly status: string
	readonly labels: Readonly<Record<string, string>>
	readonly public_net: {
		readonly ipv4: { readonly ip: string }
	}
}

export interface CreateServerInput {
	readonly name: string
	readonly serverType: string
	readonly location: string
	readonly image: string
	readonly userData: string
	readonly labels: Readonly<Record<string, string>>
}

export function parseServerObject(
	s: unknown,
	context: string,
): HcloudServerResponse {
	if (
		!isRecord(s) ||
		typeof s.id !== 'number' ||
		typeof s.name !== 'string' ||
		typeof s.status !== 'string'
	) {
		throw new Error(`${context}: invalid server shape`)
	}
	if (
		!isRecord(s.public_net) ||
		!isRecord(s.public_net.ipv4) ||
		typeof s.public_net.ipv4.ip !== 'string'
	) {
		throw new Error(`${context}: missing public_net.ipv4.ip`)
	}
	const labels: Record<string, string> = {}
	if (isRecord(s.labels)) {
		for (const [key, value] of Object.entries(s.labels)) {
			if (typeof value === 'string') labels[key] = value
		}
	}
	return {
		id: s.id,
		name: s.name,
		status: s.status,
		labels,
		public_net: { ipv4: { ip: s.public_net.ipv4.ip } },
	}
}

function parseServerResponse(
	data: unknown,
	context: string,
): HcloudServerResponse {
	if (!isRecord(data) || !isRecord(data.server)) {
		throw new Error(`${context}: missing \`server\` in response`)
	}
	return parseServerObject(data.server, context)
}

export async function assertServerTypeAvailable(
	token: string,
	serverTypeName: string,
): Promise<void> {
	const url = new URL(`${HCLOUD_API_BASE}/server_types`)
	url.searchParams.set('name', serverTypeName)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list server_types name="${serverTypeName}"`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !Array.isArray(data.server_types)) {
		throw new Error(
			`list server_types name="${serverTypeName}": missing \`server_types\` array`,
		)
	}
	const [first] = data.server_types
	if (!isRecord(first)) {
		throw new Error(
			`Hetzner server_type "${serverTypeName}" not found - check the SKU name`,
		)
	}
	if (first.deprecated === true) {
		const reason =
			isRecord(first.deprecation) && typeof first.deprecation === 'object'
				? ` (${JSON.stringify(first.deprecation)})`
				: ''
		throw new Error(
			`Hetzner server_type "${serverTypeName}" is deprecated${reason} - pick a current SKU, never auto-substitute`,
		)
	}
}

export async function createServer(
	token: string,
	input: CreateServerInput,
): Promise<HcloudServerResponse> {
	const response = await fetch(`${HCLOUD_API_BASE}/servers`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({
			name: input.name,
			server_type: input.serverType,
			location: input.location,
			image: input.image,
			user_data: input.userData,
			labels: input.labels,
			start_after_create: true,
		}),
	})
	await requireOk(response, `create server "${input.name}"`)
	const data: unknown = await response.json()
	return parseServerResponse(data, `create server "${input.name}"`)
}

export async function describeServer(
	token: string,
	serverId: number,
): Promise<HcloudServerResponse> {
	const response = await fetch(`${HCLOUD_API_BASE}/servers/${serverId}`, {
		headers: authHeaders(token),
	})
	await requireOk(response, `describe server ${serverId}`)
	const data: unknown = await response.json()
	return parseServerResponse(data, `describe server ${serverId}`)
}

export async function findServerById(
	token: string,
	serverId: number,
): Promise<HcloudServerResponse | null> {
	const response = await fetch(`${HCLOUD_API_BASE}/servers/${serverId}`, {
		headers: authHeaders(token),
	})
	if (response.status === HTTP_NOT_FOUND) return null
	await requireOk(response, `find server ${serverId}`)
	const data: unknown = await response.json()
	return parseServerResponse(data, `find server ${serverId}`)
}

export async function findServersByLabels(
	token: string,
	labels: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<HcloudServerResponse>> {
	const selector = formatLabelSelector(labels)
	const url = new URL(`${HCLOUD_API_BASE}/servers`)
	url.searchParams.set('label_selector', selector)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list servers label_selector="${selector}"`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !Array.isArray(data.servers)) {
		throw new Error(
			`list servers label_selector="${selector}": missing \`servers\` array`,
		)
	}
	const servers: ReadonlyArray<unknown> = data.servers
	return servers.map((s, i) => parseServerObject(s, `servers[${i}]`))
}

/**
 * Delete a server. Returns silently if the server is already gone (404),
 * making this safe for idempotent teardown.
 */
export async function deleteServer(
	token: string,
	serverId: number,
): Promise<void> {
	const response = await fetch(`${HCLOUD_API_BASE}/servers/${serverId}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	if (response.status === HTTP_NOT_FOUND) return
	await requireOk(response, `delete server ${serverId}`)
}
