import type { APIRoute } from 'astro'

import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { notImplemented } from '@/lib/domain/api-result.ts'

export const prerender = false

export const GET: APIRoute = ({ params }) =>
	jsonResponse(
		notImplemented(`vps.${params.slug}.metrics`),
		HTTP_STATUS.NOT_IMPLEMENTED,
	)
