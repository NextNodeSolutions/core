import { ENV_KEYS, getEnv, requireEnv } from '@/lib/adapters/env.ts'
import { getVpsState } from '@/lib/adapters/r2/state.ts'
import { runSdEndpoint } from '@/lib/adapters/sd-endpoint-runner.ts'
import { listTaggedDevices } from '@/lib/adapters/tailscale/devices.ts'
import {
	CLIENT_VPS_TAG,
	buildSdTargets,
} from '@/lib/domain/monitoring/sd-targets.ts'

import type { APIRoute } from 'astro'
import type { R2StateClient } from '@/lib/adapters/r2/state.ts'
import type { VpsStateSlice } from '@/lib/domain/hetzner/vps-state.ts'
import type { TaggedDevice } from '@/lib/domain/tailscale/tagged-device.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const resolveStateClient = (): R2StateClient => ({
	accountId: requireEnv(ENV_KEYS.CLOUDFLARE_ACCOUNT_ID),
	accessKeyId: requireEnv(ENV_KEYS.R2_ACCESS_KEY_ID),
	secretAccessKey: requireEnv(ENV_KEYS.R2_SECRET_ACCESS_KEY),
})

const readStates = async (
	client: R2StateClient,
	devices: ReadonlyArray<TaggedDevice>,
): Promise<Record<string, VpsStateSlice | null>> => {
	const entries = await Promise.all(
		devices.map(
			async device =>
				[
					device.hostname,
					await getVpsState(client, device.hostname),
				] as const,
		),
	)
	return Object.fromEntries(entries)
}

/**
 * Prometheus http_sd endpoint: one target group per (client-vps tailnet
 * device, exporter port), labelled with the `__meta_*` set the
 * infrastructure relabel pipeline expects. Stateless: Tailscale API +
 * R2 state joined per request, each behind a 60 s cache.
 */
export const GET: APIRoute = () =>
	runSdEndpoint('sd.targets', async () => {
		const tsSecret = requireEnv(ENV_KEYS.TS_OAUTH_SECRET)
		const stateClient = resolveStateClient()
		const devices = await listTaggedDevices(tsSecret)
		const clientVpsDevices = devices.filter(device =>
			device.tags.includes(CLIENT_VPS_TAG),
		)
		const statesByHostname = await readStates(stateClient, clientVpsDevices)
		return buildSdTargets({
			devices: clientVpsDevices,
			statesByHostname,
			clientId: getEnv(ENV_KEYS.NN_CLIENT_ID),
		})
	})
