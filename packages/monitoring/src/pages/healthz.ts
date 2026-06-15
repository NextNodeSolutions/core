import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'

import type { APIRoute } from 'astro'

// Liveness probe consumed by the compose healthcheck (`wget 127.0.0.1:$PORT/healthz`,
// see infrastructure `buildHealthcheck`). Pure and dependency-free: a 200 means
// the node server is up and serving, which is all `service_healthy` gating needs
// - deliberately no upstream/IO checks that could flap the container unhealthy.
// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

export const GET: APIRoute = () =>
	new Response('ok', { status: HTTP_STATUS.OK })
