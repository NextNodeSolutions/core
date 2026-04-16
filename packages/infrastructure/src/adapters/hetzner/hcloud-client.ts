import { isRecord } from '../../config/types.ts'

import { HCLOUD_API_BASE, authHeaders, requireOk } from './hcloud-api.ts'
import type { FirewallRule, HcloudFirewallResponse } from './hcloud-firewall.ts'
import type { HcloudServerResponse } from './hcloud-server.ts'

export interface CreateServerInput {
	readonly name: string
	readonly serverType: string
	readonly location: string
	readonly image: string
	readonly sshKeys: ReadonlyArray<string>
	readonly userData: string
	readonly labels: Readonly<Record<string, string>>
}

function parseServer(data: unknown, context: string): HcloudServerResponse {
	if (!isRecord(data) || !isRecord(data.server)) {
		throw new Error(`${context}: missing \`server\` in response`)
	}
	const s = data.server
	if (
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

export async function assertServerTypeAvailable(
	token: string,
	serverTypeName: string,
): Promise<void> {
	const url = `${HCLOUD_API_BASE}/server_types?name=${encodeURIComponent(serverTypeName)}`
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

function parseSshKey(
	data: unknown,
	context: string,
): { readonly id: number; readonly name: string } {
	if (!isRecord(data) || !isRecord(data.ssh_key)) {
		throw new Error(`${context}: missing \`ssh_key\` in response`)
	}
	const k = data.ssh_key
	if (typeof k.id !== 'number' || typeof k.name !== 'string') {
		throw new Error(`${context}: invalid ssh_key shape`)
	}
	return { id: k.id, name: k.name }
}

function findExistingSshKey(
	data: unknown,
): { readonly id: number; readonly name: string } | null {
	if (!isRecord(data)) return null
	if (!Array.isArray(data.ssh_keys) || data.ssh_keys.length === 0) return null
	const first = data.ssh_keys[0]
	if (
		!isRecord(first) ||
		typeof first.id !== 'number' ||
		typeof first.name !== 'string'
	) {
		return null
	}
	return { id: first.id, name: first.name }
}

export async function ensureSshKey(
	token: string,
	name: string,
	publicKey: string,
): Promise<{ readonly id: number; readonly name: string }> {
	const listUrl = `${HCLOUD_API_BASE}/ssh_keys?name=${encodeURIComponent(name)}`
	const listResponse = await fetch(listUrl, { headers: authHeaders(token) })
	await requireOk(listResponse, `list ssh_keys name="${name}"`)
	const listData: unknown = await listResponse.json()
	const existing = findExistingSshKey(listData)
	if (existing) return existing

	const createResponse = await fetch(`${HCLOUD_API_BASE}/ssh_keys`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ name, public_key: publicKey }),
	})
	await requireOk(createResponse, `create ssh_key "${name}"`)
	const createData: unknown = await createResponse.json()
	return parseSshKey(createData, `create ssh_key "${name}"`)
}

function parseFirewall(data: unknown, context: string): HcloudFirewallResponse {
	if (!isRecord(data) || !isRecord(data.firewall)) {
		throw new Error(`${context}: missing \`firewall\` in response`)
	}
	const fw = data.firewall
	if (typeof fw.id !== 'number' || typeof fw.name !== 'string') {
		throw new Error(`${context}: invalid firewall shape`)
	}
	return { id: fw.id, name: fw.name }
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
			ssh_keys: input.sshKeys,
			user_data: input.userData,
			labels: input.labels,
			start_after_create: true,
		}),
	})
	await requireOk(response, `create server "${input.name}"`)
	const data: unknown = await response.json()
	return parseServer(data, `create server "${input.name}"`)
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
	return parseServer(data, `describe server ${serverId}`)
}

export async function deleteServer(
	token: string,
	serverId: number,
): Promise<void> {
	const response = await fetch(`${HCLOUD_API_BASE}/servers/${serverId}`, {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	await requireOk(response, `delete server ${serverId}`)
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
