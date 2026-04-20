import type { APIRoute } from 'astro'

import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { notImplemented } from '@/lib/domain/api-result.ts'

export const prerender = false

export const DELETE: APIRoute = ({ params }) =>
	jsonResponse(
		notImplemented(`projects.${params.slug}.delete`),
		HTTP_STATUS.NOT_IMPLEMENTED,
	)

export const POST: APIRoute = async ({ params, request }) => {
	const body = await request.formData()
	const method = body.get('_method')

	if (method === 'delete') {
		return jsonResponse(
			notImplemented(`projects.${params.slug}.delete`),
			HTTP_STATUS.NOT_IMPLEMENTED,
		)
	}

	return jsonResponse(
		notImplemented(`projects.${params.slug}.unknown-action`),
		HTTP_STATUS.BAD_REQUEST,
	)
}
