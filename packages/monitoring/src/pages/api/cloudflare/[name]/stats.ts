import { notImplementedRoute } from '@/lib/adapters/not-implemented-route.ts'

export const prerender = false

export const GET = notImplementedRoute(
	params => `cloudflare.${params.name}.stats`,
)
