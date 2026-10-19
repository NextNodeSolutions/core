const MS_PER_SECOND = 1_000

const HTTP_TIMEOUT_MS = 30_000

export interface HttpResponse {
	readonly ok: boolean
	readonly status: number
	readonly body: string
}

export interface BoundedFetchOptions extends Omit<RequestInit, 'signal'> {
	readonly operation: string
	readonly timeoutMs?: number
}

function timeoutMessage(operation: string, timeoutMs: number): string {
	return `${operation} timed out after ${String(timeoutMs / MS_PER_SECOND)}s without a complete response and was aborted - check the service's status and retry the job`
}

/**
 * The one way the adapters reach the network. The time limit covers the
 * connection, the headers and the whole body, so a server that stalls at any
 * point fails with the operation's name instead of holding the job until its
 * own timeout. `operation` lands in the error, so it never carries a secret.
 */
export async function fetchBounded(
	url: string | URL,
	options: BoundedFetchOptions,
): Promise<HttpResponse> {
	const { operation, timeoutMs = HTTP_TIMEOUT_MS, ...init } = options
	const signal = AbortSignal.timeout(timeoutMs)
	try {
		// oxlint-disable-next-line eslint/no-restricted-globals -- the bounded call every adapter goes through
		const response = await fetch(url, { ...init, signal })
		const body = await response.text()
		return { ok: response.ok, status: response.status, body }
	} catch (error) {
		if (!signal.aborted) throw error
		throw new Error(timeoutMessage(operation, timeoutMs), { cause: error })
	}
}
