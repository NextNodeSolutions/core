import { resolveCloudflareClient } from '@/lib/adapters/cloudflare/accounts.ts'
import { listDnsMatchesForVps } from '@/lib/adapters/cloudflare/vps-dns.ts'
import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { getVpsState } from '@/lib/adapters/r2/state.ts'
import { runSdEndpoint } from '@/lib/adapters/sd-endpoint-runner.ts'
import { listTaggedDevices } from '@/lib/adapters/tailscale/devices.ts'
import { selectOwnerProject } from '@/lib/domain/hetzner/vps-state.ts'
import { buildSdProbes } from '@/lib/domain/monitoring/sd-probes.ts'
import { CLIENT_VPS_TAG } from '@/lib/domain/monitoring/sd-targets.ts'

import type { APIRoute } from 'astro'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import type { R2StateClient } from '@/lib/adapters/r2/state.ts'
import type { ProbeSource } from '@/lib/domain/monitoring/sd-probes.ts'
import type { TaggedDevice } from '@/lib/domain/tailscale/tagged-device.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const resolveStateClient = (): R2StateClient => ({
	accountId: requireEnv(ENV_KEYS.CLOUDFLARE_ACCOUNT_ID),
	accessKeyId: requireEnv(ENV_KEYS.R2_ACCESS_KEY_ID),
	secretAccessKey: requireEnv(ENV_KEYS.R2_SECRET_ACCESS_KEY),
})

const buildProbeSource = async (
	device: TaggedDevice,
	stateClient: R2StateClient,
	cfClient: CloudflareClient,
): Promise<ProbeSource> => {
	const state = await getVpsState(stateClient, device.hostname)
	const publicIp = state?.publicIp ?? null
	if (state === null || publicIp === null) {
		return { hostname: device.hostname, ownerProject: null, domains: [] }
	}
	const matches = await listDnsMatchesForVps({
		client: cfClient,
		publicIpv4: publicIp,
		publicIpv6: null,
		tailnetIp: null,
	})
	const domains = [
		...new Set(matches.map(match => match.record.name)),
	].toSorted((a, b) => a.localeCompare(b))
	return {
		hostname: device.hostname,
		ownerProject: selectOwnerProject(state, device.hostname),
		domains,
	}
}

/**
 * Prometheus http_sd endpoint for the blackbox probe job: one HTTPS URL
 * per public domain of every client VPS, derived from the Cloudflare A
 * records pointing at the VPS public IPs - no probe list to maintain.
 */
export const GET: APIRoute = () =>
	runSdEndpoint('sd.probes', async () => {
		const tsSecret = requireEnv(ENV_KEYS.TS_OAUTH_SECRET)
		const stateClient = resolveStateClient()
		const cfClient = await resolveCloudflareClient()
		const devices = await listTaggedDevices(tsSecret)
		const sources = await Promise.all(
			devices
				.filter(device => device.tags.includes(CLIENT_VPS_TAG))
				.map(device => buildProbeSource(device, stateClient, cfClient)),
		)
		return buildSdProbes(sources)
	})
