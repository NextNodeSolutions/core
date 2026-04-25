import { deletableRoute } from '@/lib/adapters/method-override-route.ts'

export const prerender = false

export const { DELETE, POST } = deletableRoute(
	params => `vps.${params.slug}.teardown-and-delete`,
	params => `vps.${params.slug}.unknown-action`,
)
