import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { notImplemented } from '@/lib/domain/api-result.ts'

import type { APIRoute } from 'astro'

export const prerender = false

export const POST: APIRoute = ({ params }) =>
	jsonResponse(
		notImplemented(`projects.${params.slug}.deploy.approve`),
		HTTP_STATUS.NOT_IMPLEMENTED,
	)
