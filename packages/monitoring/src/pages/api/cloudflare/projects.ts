import { resolveCloudflareClient } from '@/lib/adapters/cloudflare/accounts.ts'
import { listPagesProjects } from '@/lib/adapters/cloudflare/pages-projects.ts'
import { runListEndpoint } from '@/lib/adapters/endpoint-runner.ts'

import type { APIRoute } from 'astro'

export const prerender = false

export const GET: APIRoute = () =>
	runListEndpoint('cloudflare.projects.list', async () => {
		const client = await resolveCloudflareClient()
		return listPagesProjects({ client })
	})
