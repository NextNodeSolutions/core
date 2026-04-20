import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'

export const HETZNER_API_BASE = 'https://api.hetzner.cloud/v1'

export class HetznerApiFailure extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly body: string,
	) {
		super(
			context,
			httpStatus,
			`${context} failed (HTTP ${String(httpStatus)}): ${body || 'no detail'}`,
		)
	}

	logContext(): Record<string, unknown> {
		return { body: this.body }
	}
}

const authHeaders = (token: string): Record<string, string> => ({
	Authorization: `Bearer ${token}`,
})

export const hetznerGet = async (
	path: string,
	token: string,
	context: string,
): Promise<unknown> => {
	const response = await fetch(`${HETZNER_API_BASE}${path}`, {
		headers: authHeaders(token),
	})
	if (!response.ok) {
		const body = await response.text()
		throw new HetznerApiFailure(context, response.status, body)
	}
	return response.json()
}
