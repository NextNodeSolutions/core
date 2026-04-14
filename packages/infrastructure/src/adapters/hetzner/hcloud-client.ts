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
