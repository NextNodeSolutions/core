import type { APIRoute } from 'astro'

import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { notImplemented } from '@/lib/domain/api-result.ts'

type ActionBuilder = (params: Record<string, string | undefined>) => string

// Delete actions are triggered from plain SSR forms (no client JS for
// fire-and-forget mutations). HTML forms can only submit GET or POST, so we
// POST with a hidden `_method=delete` field and route it here as a DELETE.
export const deletableRoute = (
	deleteAction: ActionBuilder,
	unknownAction: ActionBuilder,
): { DELETE: APIRoute; POST: APIRoute } => {
	const deleteResponse = (
		params: Record<string, string | undefined>,
	): Response =>
		jsonResponse(
			notImplemented(deleteAction(params)),
			HTTP_STATUS.NOT_IMPLEMENTED,
		)

	return {
		DELETE: ({ params }) => deleteResponse(params),
		POST: async ({ params, request }) => {
			const body = await request.formData()
			if (body.get('_method') === 'delete') return deleteResponse(params)
			return jsonResponse(
				notImplemented(unknownAction(params)),
				HTTP_STATUS.BAD_REQUEST,
			)
		},
	}
}
