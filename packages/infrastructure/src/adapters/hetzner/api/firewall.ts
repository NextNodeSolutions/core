import { isRecord } from '#/config/types.ts'
import type { FirewallRule } from '#/domain/hetzner/firewall-rules.ts'
import { HTTP_NOT_FOUND } from '#/domain/http/status.ts'

import { HCLOUD_API_BASE, authHeaders, requireOk } from './base.ts'

export interface HcloudFirewallResponse {
	readonly id: number
	readonly name: string
	readonly appliedToCount: number
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

function parseFirewall(data: unknown, context: string): HcloudFirewallResponse {
	if (!isRecord(data) || !isRecord(data.firewall)) {
		throw new Error(`${context}: missing \`firewall\` in response`)
	}
	return parseFirewallObject(data.firewall, context)
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
