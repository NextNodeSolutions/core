import {
	HTTP_NOT_FOUND,
	HTTP_UNPROCESSABLE_ENTITY,
} from '#/domain/http/status.ts'
import { isRecord } from '#/kernel/guards.ts'

import { HCLOUD_API_BASE, authHeaders, requireOk } from './base.ts'

import type { FirewallRule } from '#/domain/hetzner/firewall-rules.ts'

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

function parseFirewall(
	responseBody: unknown,
	context: string,
): HcloudFirewallResponse {
	if (!isRecord(responseBody) || !isRecord(responseBody.firewall)) {
		throw new Error(`${context}: missing \`firewall\` in response`)
	}
	return parseFirewallObject(responseBody.firewall, context)
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
	const responseBody: unknown = await response.json()
	return parseFirewall(responseBody, `find firewall ${firewallId}`)
}

export async function findFirewallsByName(
	token: string,
	name: string,
): Promise<ReadonlyArray<HcloudFirewallResponse>> {
	const url = new URL(`${HCLOUD_API_BASE}/firewalls`)
	url.searchParams.set('name', name)
	const response = await fetch(url, { headers: authHeaders(token) })
	await requireOk(response, `list firewalls name="${name}"`)
	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !Array.isArray(responseBody.firewalls)) {
		throw new Error(
			`list firewalls name="${name}": missing \`firewalls\` array`,
		)
	}
	const { firewalls } = responseBody
	return firewalls.map((fw, i) => {
		if (!isRecord(fw)) {
			throw new Error(`firewalls[${i}]: invalid firewall shape`)
		}
		return parseFirewallObject(fw, `firewalls[${i}]`)
	})
}

/**
 * Find a firewall by name, creating it only if absent. Reusing the existing
 * firewall makes provisioning idempotent: a re-run (attach / resume) no longer
 * hits Hetzner's `uniqueness_error` 409 on a name that already exists. Mirrors
 * the idempotent contract of {@link deleteFirewall} (silent 404).
 *
 * Note: an existing firewall is reused as-is; its rules are NOT reconciled.
 */
export async function ensureFirewall(
	token: string,
	name: string,
	rules: ReadonlyArray<FirewallRule>,
): Promise<HcloudFirewallResponse> {
	const [existing] = await findFirewallsByName(token, name)
	if (existing) return existing

	const response = await fetch(`${HCLOUD_API_BASE}/firewalls`, {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ name, rules }),
	})
	await requireOk(response, `create firewall "${name}"`)
	const responseBody: unknown = await response.json()
	return parseFirewall(responseBody, `create firewall "${name}"`)
}

/**
 * Apply a firewall to a server. Returns silently when Hetzner reports
 * `firewall_already_applied` (422): a provision re-run (attach / resume)
 * re-applies the firewall {@link ensureFirewall} reused, and the
 * already-applied state is exactly the desired outcome. Mirrors the
 * idempotent contracts of {@link ensureFirewall} and {@link deleteFirewall}.
 */
export async function applyFirewall(
	token: string,
	firewallId: number,
	serverId: number,
): Promise<void> {
	const context = `apply firewall ${firewallId} to server ${serverId}`
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
	if (response.status === HTTP_UNPROCESSABLE_ENTITY) {
		const body = await response.text()
		// Hetzner error payload: {"error":{"code":"firewall_already_applied",...}}
		if (body.includes('firewall_already_applied')) return
		throw new Error(`Hetzner API ${context}: ${response.status} - ${body}`)
	}
	await requireOk(response, context)
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
