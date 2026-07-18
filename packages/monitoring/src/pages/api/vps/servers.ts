import { runListEndpoint } from '@/lib/adapters/endpoint-runner.ts'
import { listFleetVps } from '@/lib/adapters/victoria/fleet.ts'

import type { APIRoute } from 'astro'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

export const GET: APIRoute = () =>
	runListEndpoint('fleet.vps.list', () => listFleetVps())
