import { notImplementedRoute } from '@/lib/adapters/not-implemented-route.ts'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

export const POST = notImplementedRoute(
	params => `cloudflare.${params.name}.deployments.${params.id}.retry`,
)
