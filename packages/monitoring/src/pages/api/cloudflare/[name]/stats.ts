import { notImplementedRoute } from '@/lib/adapters/not-implemented-route.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

export const GET = notImplementedRoute(
	params => `cloudflare.${params.name}.stats`,
)
