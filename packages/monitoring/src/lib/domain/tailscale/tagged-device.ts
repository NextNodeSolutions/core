import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * A tailnet device as the service-discovery layer sees it: hostname,
 * tailnet IPv4 and its ACL tags. Only connected devices are kept - a
 * disconnected VPS has nothing scrapable.
 */
export interface TaggedDevice {
	readonly hostname: string
	readonly ipv4: string
	readonly tags: ReadonlyArray<string>
}

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/

const firstIpv4 = (addresses: ReadonlyArray<unknown>): string | null => {
	for (const addr of addresses) {
		if (typeof addr === 'string' && IPV4_PATTERN.test(addr)) return addr
	}
	return null
}

const parseDevice = (candidate: unknown): TaggedDevice | null => {
	if (!isRecord(candidate)) return null
	if (typeof candidate.hostname !== 'string') return null
	if (candidate.connectedToControl !== true) return null
	if (!Array.isArray(candidate.addresses)) return null
	const ipv4 = firstIpv4(candidate.addresses)
	if (ipv4 === null) return null
	const tags = Array.isArray(candidate.tags)
		? candidate.tags.filter(
				// oxlint-disable-next-line typescript/no-unnecessary-condition -- Array.isArray narrows untrusted API input to any[]; the predicate validates its elements
				(tag): tag is string => typeof tag === 'string',
			)
		: []
	return { hostname: candidate.hostname, ipv4, tags }
}

/**
 * Parse the raw Tailscale `GET /tailnet/-/devices` payload down to the
 * connected, IPv4-addressable devices. Pure - the adapter feeds the raw
 * JSON in.
 */
export const parseTaggedDevices = (
	payload: unknown,
): ReadonlyArray<TaggedDevice> => {
	if (!isRecord(payload) || !Array.isArray(payload.devices)) return []
	return payload.devices
		.map(parseDevice)
		.filter((device): device is TaggedDevice => device !== null)
}
