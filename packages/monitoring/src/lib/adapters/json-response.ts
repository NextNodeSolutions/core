import type { HttpStatus } from '@/lib/adapters/http-status.ts'
import type { ApiResult } from '@/lib/domain/api-result.ts'

export const jsonResponse = <T>(
	body: ApiResult<T>,
	status: HttpStatus,
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
