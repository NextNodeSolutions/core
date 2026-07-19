import { createSign } from 'node:crypto'

import { memoizeAsync } from '@/lib/adapters/cache.ts'
import { ENV_KEYS, getEnv, MissingEnvError } from '@/lib/adapters/env.ts'
import {
	GITHUB_API_BASE,
	GITHUB_ORG_LOGIN,
	GithubApiFailure,
	GithubMalformedResponseError,
} from '@/lib/adapters/github/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * Runtime GitHub auth via the NextNode GitHub App - the same App the deploy
 * pipeline uses (create-github-app-token), reused here because installation
 * tokens expire after 1h: the CI-minted one is long dead while this app
 * serves requests, so the app mints its own. The private key travels as
 * NEXTNODE_APP_PRIVATE_KEY_B64 (base64 of the PEM) because the deploy env
 * writer rejects multiline values.
 *
 * `GH_API_TOKEN` remains an OPTIONAL override: when set (local dev with a
 * personal PAT), it is used verbatim and the App path is never touched.
 */

/** Bound every request so a hung GitHub API cannot wedge a page render. */
const APP_TIMEOUT_MS = 5000

// Installation tokens live 60 min; refresh at 50 so a token handed to an
// in-flight fan-out never expires mid-request.
const TOKEN_TTL_MS = 3_000_000

// App JWT window: 60s of clock-drift tolerance backwards, 9 min validity
// (GitHub caps exp at 10 min).
const JWT_DRIFT_SECONDS = 60
const JWT_TTL_SECONDS = 540
const MS_PER_SECOND = 1000

const HTTP_UNPROCESSABLE = 422

const base64Url = (text: string): string =>
	Buffer.from(text).toString('base64url')

/** Build the short-lived RS256 App JWT that authenticates App-level calls. */
export const buildAppJwt = (
	appId: string,
	privateKeyPem: string,
	nowSeconds: number,
): string => {
	const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
	const payload = base64Url(
		JSON.stringify({
			iat: nowSeconds - JWT_DRIFT_SECONDS,
			exp: nowSeconds + JWT_TTL_SECONDS,
			iss: appId,
		}),
	)
	const signingInput = `${header}.${payload}`
	const signature = createSign('RSA-SHA256')
		.update(signingInput)
		.sign(privateKeyPem)
		.toString('base64url')
	return `${signingInput}.${signature}`
}

const appFetch = async (
	path: string,
	jwt: string,
	method: 'GET' | 'POST',
	context: string,
): Promise<unknown> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), APP_TIMEOUT_MS)
	let response: Response
	try {
		response = await fetch(`${GITHUB_API_BASE}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'nextnode-monitoring',
			},
			signal: controller.signal,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		throw new GithubApiFailure(context, 0, message)
	} finally {
		clearTimeout(timer)
	}
	if (!response.ok) {
		throw new GithubApiFailure(
			context,
			response.status,
			await response.text(),
		)
	}
	return response.json()
}

export interface GithubAppCredentials {
	readonly appId: string
	readonly privateKeyPem: string
}

/**
 * Mint an installation token for the org: App JWT -> the org's installation
 * id -> a fresh installation access token. Exported for tests; production
 * callers go through the cached `resolveGithubToken`.
 */
export const mintInstallationToken = async (
	credentials: GithubAppCredentials,
	nowSeconds: number,
): Promise<string> => {
	const jwt = buildAppJwt(
		credentials.appId,
		credentials.privateKeyPem,
		nowSeconds,
	)
	const installationContext = `GitHub App installation for org "${GITHUB_ORG_LOGIN}"`
	const installation = await appFetch(
		`/orgs/${GITHUB_ORG_LOGIN}/installation`,
		jwt,
		'GET',
		installationContext,
	)
	if (!isRecord(installation) || typeof installation.id !== 'number') {
		throw new GithubMalformedResponseError(
			installationContext,
			'expected an installation with a numeric `id`',
		)
	}
	const tokenContext = `GitHub App installation token for org "${GITHUB_ORG_LOGIN}"`
	const minted = await appFetch(
		`/app/installations/${String(installation.id)}/access_tokens`,
		jwt,
		'POST',
		tokenContext,
	)
	if (!isRecord(minted) || typeof minted.token !== 'string') {
		throw new GithubMalformedResponseError(
			tokenContext,
			'expected a `token` string',
		)
	}
	return minted.token
}

const decodePrivateKey = (keyB64: string): string => {
	const pem = Buffer.from(keyB64, 'base64').toString('utf8')
	if (!pem.includes('PRIVATE KEY')) {
		// A non-PEM decode means the secret holds the raw key (or garbage),
		// not its base64 - fail with the actionable message, not an opaque
		// crypto error from the signer.
		throw new GithubApiFailure(
			'GitHub App private key',
			HTTP_UNPROCESSABLE,
			'NEXTNODE_APP_PRIVATE_KEY_B64 does not decode to a PEM private key',
		)
	}
	return pem
}

const mintCachedAppToken = memoizeAsync(TOKEN_TTL_MS, () => {
	const appId = getEnv(ENV_KEYS.NEXTNODE_APP_ID)
	if (!appId) throw new MissingEnvError(ENV_KEYS.NEXTNODE_APP_ID)
	const keyB64 = getEnv(ENV_KEYS.NEXTNODE_APP_PRIVATE_KEY_B64)
	if (!keyB64)
		throw new MissingEnvError(ENV_KEYS.NEXTNODE_APP_PRIVATE_KEY_B64)
	return mintInstallationToken(
		{ appId, privateKeyPem: decodePrivateKey(keyB64) },
		Math.floor(Date.now() / MS_PER_SECOND),
	)
})

/**
 * The runtime GitHub token: the GH_API_TOKEN override when set, otherwise a
 * cached App installation token (re-minted before its 1h expiry).
 */
export const resolveGithubToken = (): Promise<string> => {
	const override = getEnv(ENV_KEYS.GH_API_TOKEN)
	if (override) return Promise.resolve(override)
	return mintCachedAppToken()
}
