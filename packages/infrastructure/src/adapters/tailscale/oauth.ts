import { setTimeout as sleep } from 'node:timers/promises'

import { TailnetAclScopeError } from '#/domain/tailnet/client.ts'
import { isRecord } from '#/kernel/guards.ts'

import type { MintedAuthkey, TailnetClient } from '#/domain/tailnet/client.ts'

const HTTP_FORBIDDEN = 403

const TAILSCALE_API_BASE = 'https://api.tailscale.com/api/v2'
const DEVICE_POLL_INTERVAL_MS = 2_000
const DEVICE_POLL_MAX_ATTEMPTS = 45

async function exchangeClientSecret(clientSecret: string): Promise<string> {
	const basic = Buffer.from(`${clientSecret}:`).toString('base64')
	const response = await fetch(`${TAILSCALE_API_BASE}/oauth/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	})
	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale OAuth token exchange: ${response.status} - ${body}`,
		)
	}
	const responseBody: unknown = await response.json()
	if (
		!isRecord(responseBody) ||
		typeof responseBody.access_token !== 'string'
	) {
		throw new Error('Tailscale OAuth token exchange: missing access_token')
	}
	return responseBody.access_token
}

export async function mintAuthkey(
	clientSecret: string,
	tags: ReadonlyArray<string>,
	ttlSeconds: number,
	description: string,
): Promise<MintedAuthkey> {
	if (tags.length === 0) {
		throw new Error('mintAuthkey requires at least one tag')
	}

	const accessToken = await exchangeClientSecret(clientSecret)

	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/keys`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			capabilities: {
				devices: {
					create: {
						reusable: false,
						ephemeral: false,
						preauthorized: true,
						tags: [...tags],
					},
				},
			},
			expirySeconds: ttlSeconds,
			description,
		}),
	})

	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale create authkey: ${response.status} - ${body}`,
		)
	}

	const responseBody: unknown = await response.json()
	if (
		!isRecord(responseBody) ||
		typeof responseBody.key !== 'string' ||
		typeof responseBody.expires !== 'string'
	) {
		throw new Error('Tailscale create authkey: invalid response shape')
	}
	return { key: responseBody.key, expires: responseBody.expires }
}

function extractIpv4FromAddresses(
	addresses: ReadonlyArray<unknown>,
): string | null {
	for (const addr of addresses) {
		if (typeof addr === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
			return addr
		}
	}
	return null
}

function isConnectedDevice(
	device: unknown,
	hostname: string,
): device is Record<string, unknown> & {
	addresses: ReadonlyArray<unknown>
	created: string
} {
	return (
		isRecord(device) &&
		device.hostname === hostname &&
		device.connectedToControl === true &&
		Array.isArray(device.addresses) &&
		typeof device.created === 'string'
	)
}

function findDeviceIpv4(devices: unknown, hostname: string): string | null {
	if (!isRecord(devices) || !Array.isArray(devices.devices)) return null

	const candidates = devices.devices
		.filter((d: unknown) => isConnectedDevice(d, hostname))
		.map(d => ({
			ipv4: extractIpv4FromAddresses(d.addresses),
			created: d.created,
		}))
		.filter((d): d is { ipv4: string; created: string } => d.ipv4 !== null)

	candidates.sort((a, b) => b.created.localeCompare(a.created))
	const [newest] = candidates
	return newest?.ipv4 ?? null
}

function collectDeviceIdsByHostname(
	devices: unknown,
	hostname: string,
): ReadonlyArray<string> {
	if (!isRecord(devices) || !Array.isArray(devices.devices)) return []

	return devices.devices
		.filter(
			(d: unknown): d is Record<string, unknown> & { id: string } =>
				isRecord(d) &&
				d.hostname === hostname &&
				typeof d.id === 'string',
		)
		.map(d => d.id)
}

async function listDevices(accessToken: string): Promise<unknown> {
	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/devices`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	})
	if (!response.ok) {
		const body = await response.text()
		throw new Error(`Tailscale list devices: ${response.status} - ${body}`)
	}
	return response.json()
}

async function deleteDevice(
	accessToken: string,
	deviceId: string,
): Promise<void> {
	const response = await fetch(`${TAILSCALE_API_BASE}/device/${deviceId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${accessToken}` },
	})
	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale delete device ${deviceId}: ${response.status} - ${body}`,
		)
	}
}

export async function deleteTailnetDevicesByHostname(
	clientSecret: string,
	hostname: string,
): Promise<number> {
	const accessToken = await exchangeClientSecret(clientSecret)

	const devices = await listDevices(accessToken)
	const ids = collectDeviceIdsByHostname(devices, hostname)

	await Promise.all(ids.map(id => deleteDevice(accessToken, id)))
	return ids.length
}

export async function getTailnetIpByHostname(
	clientSecret: string,
	hostname: string,
): Promise<string> {
	const accessToken = await exchangeClientSecret(clientSecret)

	for (let attempt = 1; attempt <= DEVICE_POLL_MAX_ATTEMPTS; attempt++) {
		// oxlint-disable-next-line no-await-in-loop -- polling until device joins tailnet
		const devices = await listDevices(accessToken)
		const ip = findDeviceIpv4(devices, hostname)
		if (ip) return ip

		// oxlint-disable-next-line no-await-in-loop -- polling until device joins tailnet
		await sleep(DEVICE_POLL_INTERVAL_MS)
	}

	throw new Error(
		`Tailnet device "${hostname}" not found after ${DEVICE_POLL_MAX_ATTEMPTS} attempts`,
	)
}

export async function getAclPolicy(
	clientSecret: string,
): Promise<Record<string, unknown>> {
	const accessToken = await exchangeClientSecret(clientSecret)
	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/acl`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/json',
		},
	})
	if (response.status === HTTP_FORBIDDEN) {
		throw new TailnetAclScopeError(
			`Tailscale get ACL: 403 - the OAuth client lacks the "acl" scope`,
		)
	}
	if (!response.ok) {
		throw new Error(
			`Tailscale get ACL: ${response.status} - ${await response.text()}`,
		)
	}
	const body: unknown = await response.json()
	if (!isRecord(body)) {
		throw new Error('Tailscale get ACL: response was not a JSON object')
	}
	return body
}

export async function setAclPolicy(
	clientSecret: string,
	policy: Record<string, unknown>,
): Promise<void> {
	const accessToken = await exchangeClientSecret(clientSecret)
	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/acl`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(policy),
	})
	if (response.status === HTTP_FORBIDDEN) {
		throw new TailnetAclScopeError(
			`Tailscale set ACL: 403 - the OAuth client lacks the "acl" scope`,
		)
	}
	if (!response.ok) {
		throw new Error(
			`Tailscale set ACL: ${response.status} - ${await response.text()}`,
		)
	}
}

export function createTailnetClient(clientSecret: string): TailnetClient {
	return {
		mintAuthkey: (tags, ttlSeconds, description) =>
			mintAuthkey(clientSecret, tags, ttlSeconds, description),
		getIpByHostname: hostname =>
			getTailnetIpByHostname(clientSecret, hostname),
		deleteByHostname: hostname =>
			deleteTailnetDevicesByHostname(clientSecret, hostname),
		getAclPolicy: () => getAclPolicy(clientSecret),
		setAclPolicy: policy => setAclPolicy(clientSecret, policy),
	}
}
