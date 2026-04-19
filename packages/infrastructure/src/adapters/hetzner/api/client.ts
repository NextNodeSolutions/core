import { isRecord } from '../../../config/types.ts'
import type { FirewallRule } from '../../../domain/hetzner/firewall-rules.ts'
import { HTTP_NOT_FOUND } from '../../http.ts'

import { HCLOUD_API_BASE, authHeaders, requireOk } from './base.ts'
import type { HcloudFirewallResponse } from './firewall.ts'
import type { HcloudImageResponse } from './image.ts'
import type { HcloudServerResponse } from './server.ts'

export interface CreateServerInput {
	readonly name: string
	readonly serverType: string
	readonly location: string
	readonly image: string
	readonly userData: string
	readonly labels: Readonly<Record<string, string>>
}

function parseServerObject(s: unknown, context: string): HcloudServerResponse {
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
	return {
		id: s.id,
		name: s.name,
		status: s.status,
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
			`Hetzner server_type "${serverTypeName}" not found — check the SKU name`,
		)
	}
	if (first.deprecated === true) {
		const reason =
			isRecord(first.deprecation) && typeof first.deprecation === 'object'
				? ` (${JSON.stringify(first.deprecation)})`
				: ''
		throw new Error(
			`Hetzner server_type "${serverTypeName}" is deprecated${reason} — pick a current SKU, never auto-substitute`,
		)
	}
}

function parseFirewall(data: unknown, context: string): HcloudFirewallResponse {
	if (!isRecord(data) || !isRecord(data.firewall)) {
		throw new Error(`${context}: missing \`firewall\` in response`)
	}
	return parseFirewallObject(data.firewall, context)
}

function parseFirewallObject(
	fw: Record<string, unknown>,
	context: string,
): HcloudFirewallResponse {
	if (typeof fw.id !== 'number' || typeof fw.name !== 'string') {
		throw new Error(`${context}: invalid firewall shape`)
	}
	const appliedToCount = Array.isArray(fw.applied_to)
		? fw.applied_to.length
		: 0
	return { id: fw.id, name: fw.name, appliedToCount }
}

export async function findFirewallById(
	token: string,
	firewallId: number,
): Promise<HcloudFirewallResponse | null> {
	const response = await fetch(`${HCLOUD_API_BASE}/firewalls/${firewallId}`, {
		headers: authHeaders(token),
	})
	if (response.status === HTTP_NOT_FOUND) return null
	await requireOk(response, `find firewall ${firewallId}`)
	const data: unknown = await response.json()
	return parseFirewall(data, `find firewall ${firewallId}`)
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
	// Build Hetzner label_selector: "key1=value1,key2=value2"
	const selector = Object.entries(labels)
		.map(([k, v]) => `${k}=${v}`)
		.join(',')
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

export async function findFirewallsByName(
	token: string,
	name: string,
): Promise<ReadonlyArray<HcloudFirewallResponse>> {
	const url = new URL(`${HCLOUD_API_BASE}/firewalls`)
	url.searchParams.set('name', name)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list firewalls name="${name}"`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !Array.isArray(data.firewalls)) {
		throw new Error(
			`list firewalls name="${name}": missing \`firewalls\` array`,
		)
	}
	const firewalls: ReadonlyArray<unknown> = data.firewalls
	return firewalls.map((fw, i) => {
		if (!isRecord(fw)) {
			throw new Error(`firewalls[${i}]: invalid firewall shape`)
		}
		return parseFirewallObject(fw, `firewalls[${i}]`)
	})
}

/**
 * Delete a firewall. Returns silently if already gone (404),
 * making this safe for idempotent teardown.
 */
export async function deleteFirewall(
	token: string,
	firewallId: number,
): Promise<void> {
	const response = await fetch(`${HCLOUD_API_BASE}/firewalls/${firewallId}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	if (response.status === HTTP_NOT_FOUND) return
	await requireOk(response, `delete firewall ${firewallId}`)
}

export async function createFirewall(
	token: string,
	name: string,
	rules: ReadonlyArray<FirewallRule>,
): Promise<HcloudFirewallResponse> {
	const response = await fetch(`${HCLOUD_API_BASE}/firewalls`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ name, rules }),
	})
	await requireOk(response, `create firewall "${name}"`)
	const data: unknown = await response.json()
	return parseFirewall(data, `create firewall "${name}"`)
}

export async function applyFirewall(
	token: string,
	firewallId: number,
	serverId: number,
): Promise<void> {
	const response = await fetch(
		`${HCLOUD_API_BASE}/firewalls/${firewallId}/actions/apply_to_resources`,
		{
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				apply_to: [{ type: 'server', server: { id: serverId } }],
			}),
		},
	)
	await requireOk(
		response,
		`apply firewall ${firewallId} to server ${serverId}`,
	)
}

function parseImageObject(img: unknown, context: string): HcloudImageResponse {
	if (
		!isRecord(img) ||
		typeof img.id !== 'number' ||
		typeof img.description !== 'string' ||
		typeof img.created !== 'string'
	) {
		throw new Error(`${context}: invalid image shape`)
	}
	// Manual runtime narrowing — img.labels is untyped (unknown).
	// TODO: replace with schema validation (e.g. Zod) when we add one.
	const labels: Record<string, string> = {}
	if (isRecord(img.labels)) {
		for (const [k, v] of Object.entries(img.labels)) {
			if (typeof v === 'string') labels[k] = v
		}
	}
	return {
		id: img.id,
		description: img.description,
		created: img.created,
		labels,
	}
}

export async function findImagesByLabels(
	token: string,
	labels: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<HcloudImageResponse>> {
	// Build Hetzner label_selector: "key1=value1,key2=value2"
	const selector = Object.entries(labels)
		.map(([k, v]) => `${k}=${v}`)
		.join(',')
	const url = new URL(`${HCLOUD_API_BASE}/images`)
	url.searchParams.set('type', 'snapshot')
	url.searchParams.set('label_selector', selector)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list images label_selector="${selector}"`)
	const data: unknown = await response.json()
	if (!isRecord(data) || !Array.isArray(data.images)) {
		throw new Error(
			`list images label_selector="${selector}": missing \`images\` array`,
		)
	}
	const images: ReadonlyArray<unknown> = data.images
	return images.map((img, i) => parseImageObject(img, `images[${i}]`))
}

export async function deleteImage(
	token: string,
	imageId: number,
): Promise<void> {
	const response = await fetch(`${HCLOUD_API_BASE}/images/${imageId}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	await requireOk(response, `delete image ${imageId}`)
}
