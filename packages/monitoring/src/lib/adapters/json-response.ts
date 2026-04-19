import type { HttpStatus } from '@/lib/adapters/http-status.ts'
import type { NotImplementedResult } from '@/lib/domain/api-result.ts'

export const jsonResponse = (
	body: NotImplementedResult,
	status: HttpStatus,
): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
