import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

const TAILSCALE_API_BASE = 'https://api.tailscale.com/api/v2'

const exchangeClientSecret = async (clientSecret: string): Promise<string> => {
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
			`Tailscale OAuth token exchange: ${String(response.status)} — ${body}`,
		)
	}
	const data: unknown = await response.json()
	if (!isRecord(data) || typeof data.access_token !== 'string') {
		throw new Error('Tailscale OAuth token exchange: missing access_token')
	}
	return data.access_token
}

const listDevices = async (accessToken: string): Promise<unknown> => {
	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/devices`, {
		headers: { Authorization: `Bearer ${accessToken}` },
	})
	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale list devices: ${String(response.status)} — ${body}`,
		)
	}
	return response.json()
}

const extractIpv4FromAddresses = (
	addresses: ReadonlyArray<unknown>,
): string | null => {
	for (const addr of addresses) {
		if (typeof addr === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
			return addr
		}
	}
	return null
}

const isConnectedDevice = (
	device: unknown,
	hostname: string,
): device is Record<string, unknown> & {
	addresses: ReadonlyArray<unknown>
	created: string
} =>
	isRecord(device) &&
	device.hostname === hostname &&
	device.connectedToControl === true &&
	Array.isArray(device.addresses) &&
	typeof device.created === 'string'

const findDeviceIpv4 = (devices: unknown, hostname: string): string | null => {
	if (!isRecord(devices) || !Array.isArray(devices.devices)) return null

	const candidates = devices.devices
		.filter((d: unknown) => isConnectedDevice(d, hostname))
		.map(d => ({
			ipv4: extractIpv4FromAddresses(d.addresses),
			created: d.created,
		}))
		.filter((d): d is { ipv4: string; created: string } => d.ipv4 !== null)

	if (candidates.length === 0) return null

	return (
		candidates.toSorted((a, b) => b.created.localeCompare(a.created))[0]
			?.ipv4 ?? null
	)
}

// Tailscale device IPs change only when a host re-registers — rare enough
// that 60 s is well within "fresh enough" for the monitoring view, and it
// collapses two sequential fetches (token exchange + list devices) into a
// single cached lookup per host per minute.
const TAILNET_IP_TTL_MS = 60_000

// Returns `null` instead of throwing when the device is not (yet) on the
// tailnet. The monitoring dashboard surfaces this via the empty state — it
// does not poll.
const fetchTailnetIpByHostname = async (args: {
	clientSecret: string
	hostname: string
}): Promise<string | null> => {
	const accessToken = await exchangeClientSecret(args.clientSecret)
	const data = await listDevices(accessToken)
	return findDeviceIpv4(data, args.hostname)
}

const memoizedGetTailnetIpByHostname = keyedMemoizeAsync(
	TAILNET_IP_TTL_MS,
	(args: { clientSecret: string; hostname: string }) =>
		`${args.clientSecret} ${args.hostname}`,
	fetchTailnetIpByHostname,
)

export const getTailnetIpByHostname = (
	clientSecret: string,
	hostname: string,
): Promise<string | null> =>
	memoizedGetTailnetIpByHostname({ clientSecret, hostname })
