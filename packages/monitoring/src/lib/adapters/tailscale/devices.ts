import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	exchangeClientSecret,
	listDevices,
} from '@/lib/adapters/tailscale/oauth.ts'
import { parseTaggedDevices } from '@/lib/domain/tailscale/tagged-device.ts'

import type { TaggedDevice } from '@/lib/domain/tailscale/tagged-device.ts'

// The SD endpoint is polled by vmagent every 60 s; one upstream fetch per
// window keeps the Tailscale API quota comfortable and the answer fresh.
const DEVICES_TTL_MS = 60_000

const fetchTaggedDevices = async (args: {
	clientSecret: string
}): Promise<ReadonlyArray<TaggedDevice>> => {
	const accessToken = await exchangeClientSecret(args.clientSecret)
	return parseTaggedDevices(await listDevices(accessToken))
}

const memoizedListTaggedDevices = keyedMemoizeAsync(
	DEVICES_TTL_MS,
	(args: { clientSecret: string }) => args.clientSecret,
	fetchTaggedDevices,
)

/**
 * List the connected tailnet devices with their tags, memoized 60 s per
 * OAuth client secret (in practice there is exactly one).
 */
export const listTaggedDevices = (
	clientSecret: string,
): Promise<ReadonlyArray<TaggedDevice>> =>
	memoizedListTaggedDevices({ clientSecret })
