import type { APIRoute } from 'astro'

import { runListEndpoint } from '@/lib/adapters/endpoint-runner.ts'
import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { listServers } from '@/lib/adapters/hetzner/servers.ts'

export const prerender = false

export const GET: APIRoute = () =>
	runListEndpoint('hetzner.servers.list', () => {
		const token = requireEnv(ENV_KEYS.HETZNER_API_TOKEN)
		return listServers(token)
	})
