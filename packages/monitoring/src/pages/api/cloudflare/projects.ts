import type { APIRoute } from 'astro'

import { resolveAccountId } from '@/lib/adapters/cloudflare/accounts.ts'
import { listPagesProjects } from '@/lib/adapters/cloudflare/pages-projects.ts'
import { runListEndpoint } from '@/lib/adapters/endpoint-runner.ts'
import { ENV_KEYS, getEnv, requireEnv } from '@/lib/adapters/env.ts'

export const prerender = false

export const GET: APIRoute = () =>
	runListEndpoint('cloudflare.projects.list', async () => {
		const token = requireEnv(ENV_KEYS.CLOUDFLARE_API_TOKEN)
		const accountId =
			getEnv(ENV_KEYS.CLOUDFLARE_ACCOUNT_ID) ??
			(await resolveAccountId(token))
		return listPagesProjects(accountId, token)
	})
