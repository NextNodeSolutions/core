import { createVerify, generateKeyPairSync } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	buildAppJwt,
	mintInstallationToken,
} from '@/lib/adapters/github/app-token.ts'
import {
	GithubApiFailure,
	GithubMalformedResponseError,
} from '@/lib/adapters/github/client.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const NOW_SECONDS = 1_750_000_000

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})

const decodeJwtPayload = (jwt: string): Record<string, unknown> => {
	const [, payload] = jwt.split('.')
	return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('buildAppJwt', () => {
	it('produces a validly signed RS256 JWT with the app id as issuer', () => {
		const jwt = buildAppJwt('12345', privateKey, NOW_SECONDS)
		const [header, payload, signature] = jwt.split('.')

		const verified = createVerify('RSA-SHA256')
			.update(`${header}.${payload}`)
			.verify(publicKey, Buffer.from(signature ?? '', 'base64url'))
		expect(verified).toBe(true)

		const claims = decodeJwtPayload(jwt)
		expect(claims.iss).toBe('12345')
		expect(claims.iat).toBeLessThan(NOW_SECONDS)
		expect(claims.exp).toBeGreaterThan(NOW_SECONDS)
	})
})

describe('mintInstallationToken', () => {
	it('resolves the org installation then mints its access token', async () => {
		const fetchStub = vi.fn(
			(
				url: string,
				init?: {
					method?: string
					headers?: Record<string, string>
				},
			) => {
				if (url.includes('/orgs/NextNodeSolutions/installation')) {
					return Promise.resolve(jsonResponse({ id: 42 }))
				}
				if (url.includes('/app/installations/42/access_tokens')) {
					expect(init?.method).toBe('POST')
					return Promise.resolve(
						jsonResponse({ token: 'ghs_minted' }, 201),
					)
				}
				return Promise.resolve(
					jsonResponse({ message: 'unexpected' }, 500),
				)
			},
		)
		vi.stubGlobal('fetch', fetchStub)

		await expect(
			mintInstallationToken(
				{ appId: '12345', privateKeyPem: privateKey },
				NOW_SECONDS,
			),
		).resolves.toBe('ghs_minted')

		// Both calls authenticate with the App JWT (Bearer), not a token.
		for (const [, init] of fetchStub.mock.calls) {
			expect(init?.headers?.Authorization).toMatch(/^Bearer ey/)
		}
	})

	it('throws a malformed-response error when the installation lacks an id', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(jsonResponse({ message: 'incident' }))),
		)

		await expect(
			mintInstallationToken(
				{ appId: '12345', privateKeyPem: privateKey },
				NOW_SECONDS,
			),
		).rejects.toBeInstanceOf(GithubMalformedResponseError)
	})

	it('surfaces an HTTP failure as a GithubApiFailure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(jsonResponse({ message: 'nope' }, 401)),
			),
		)

		await expect(
			mintInstallationToken(
				{ appId: '12345', privateKeyPem: privateKey },
				NOW_SECONDS,
			),
		).rejects.toBeInstanceOf(GithubApiFailure)
	})
})
