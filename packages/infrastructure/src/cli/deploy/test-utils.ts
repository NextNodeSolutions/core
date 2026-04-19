/**
 * Shared helpers for stubbing `fetch` in deploy command tests.
 *
 * Kept next to its only consumers (cli/deploy/*.command.test.ts) rather than
 * promoted to a package-wide test folder: the mock shape is specific to the
 * Cloudflare API envelope tests assert, and nothing outside this folder needs
 * it.
 */

export interface MockResponse {
	ok: boolean
	status: number
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
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

export function notFound(): MockResponse {
	return {
		ok: false,
		status: 404,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve('Not found'),
	}
}

export function urlOf(input: FetchInput): string {
	return typeof input === 'string' ? input : input.toString()
}

export function methodOf(init: RequestInit | undefined): string {
	return init?.method ?? 'GET'
}
