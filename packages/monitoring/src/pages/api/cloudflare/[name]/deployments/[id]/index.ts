import { deletableRoute } from '@/lib/adapters/method-override-route.ts'

export const prerender = false

export const { DELETE, POST } = deletableRoute(
	params => `cloudflare.${params.name}.deployments.${params.id}.delete`,
	params =>
		`cloudflare.${params.name}.deployments.${params.id}.unknown-action`,
)
