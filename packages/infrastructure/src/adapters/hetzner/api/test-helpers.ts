import type { vi } from 'vitest'

export interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204

export function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: HTTP_OK,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

export function noContent(): MockResponse {
	return {
		ok: true,
		status: HTTP_NO_CONTENT,
		json: () => Promise.resolve(null),
		text: () => Promise.resolve(''),
	}
}

export function httpError(status: number, body: string): MockResponse {
	return {
		ok: false,
		status,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(body),
	}
}

export function lastCall(
	mock: ReturnType<typeof vi.fn>,
): [string, RequestInit] {
	const [url, init] = mock.mock.lastCall ?? []
	if (!url) throw new Error('No calls recorded')
	return [String(url), init]
}

export function lastBody(
	mock: ReturnType<typeof vi.fn>,
): Record<string, unknown> {
	const [, init] = lastCall(mock)
	return JSON.parse(String(init.body))
}

export const TEST_TOKEN = 'hcloud-test-token'
