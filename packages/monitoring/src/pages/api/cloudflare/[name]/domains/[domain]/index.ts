import { deletableRoute } from '@/lib/adapters/method-override-route.ts'

export const prerender = false

export const { DELETE, POST } = deletableRoute(
	params => `cloudflare.${params.name}.domains.${params.domain}.delete`,
	params =>
		`cloudflare.${params.name}.domains.${params.domain}.unknown-action`,
)
