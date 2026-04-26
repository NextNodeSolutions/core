import type { vi } from 'vitest'

/**
 * Shared fetch stub helpers for every adapter and cli command test that
 * needs to fake an HTTP response. Centralized so the `MockResponse`
 * shape, the status-code builders, and the call-recording helpers stay
 * in lock-step across all 30+ test files.
 */

const HTTP_OK = 200
const HTTP_NO_CONTENT = 204
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

export interface MockResponse {
	readonly ok: boolean
	readonly status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

export type FetchInput = string | URL

export type FetchImpl = (
	input: FetchInput,
	init?: RequestInit,
) => Promise<MockResponse>

export function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: HTTP_OK,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

export function okEmpty(): MockResponse {
	return okJson({})
}

export function noContent(): MockResponse {
	return {
		ok: true,
		status: HTTP_NO_CONTENT,
		json: () => Promise.resolve(null),
		text: () => Promise.resolve(''),
	}
}

export function notFound(): MockResponse {
	return httpError(HTTP_NOT_FOUND, 'Not found')
}

export function unauthorized(): MockResponse {
	return httpError(HTTP_UNAUTHORIZED, 'Unauthorized')
}

export function httpError(status: number, body: string): MockResponse {
	return {
		ok: false,
		status,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(body),
	}
}

export function urlOf(input: FetchInput): string {
	return typeof input === 'string' ? input : input.toString()
}

export function methodOf(init: RequestInit | undefined): string {
	return init?.method ?? 'GET'
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
