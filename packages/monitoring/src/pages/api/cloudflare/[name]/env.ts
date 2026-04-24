import { notImplementedRoute } from '@/lib/adapters/not-implemented-route.ts'

export const prerender = false

export const POST = notImplementedRoute(
	params => `cloudflare.${params.name}.env.update`,
)
