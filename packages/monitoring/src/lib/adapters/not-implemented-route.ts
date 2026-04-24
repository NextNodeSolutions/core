import type { APIRoute } from 'astro'

import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { notImplemented } from '@/lib/domain/api-result.ts'

export const notImplementedRoute =
	(
		action: (params: Record<string, string | undefined>) => string,
	): APIRoute =>
	({ params }) =>
		jsonResponse(
			notImplemented(action(params)),
			HTTP_STATUS.NOT_IMPLEMENTED,
		)
