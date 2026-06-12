import { deletableRoute } from '@/lib/adapters/method-override-route.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

export const { DELETE, POST } = deletableRoute(
	params => `cloudflare.${params.name}.delete`,
	params => `cloudflare.${params.name}.unknown-action`,
)
