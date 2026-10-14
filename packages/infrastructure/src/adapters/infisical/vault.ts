import { isRecord } from '#/kernel/guards.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const INFISICAL_API_BASE = 'https://app.infisical.com/api'
const HTTP_NOT_FOUND = 404
// `error` code Infisical returns when the folder at `secretPath` does not exist.
const SECRET_PATH_NOT_FOUND = 'SecretPathNotFound'
const ROOT_PATH = '/'

// Where the secrets live inside Infisical: one project, one environment slug.
export interface InfisicalVaultLocation {
	readonly projectId: string
	readonly environment: string
}

interface InfisicalSession extends InfisicalVaultLocation {
	readonly accessToken: string
}

function authHeaders(accessToken: string): Record<string, string> {
	return {
		Authorization: `Bearer ${accessToken}`,
		'Content-Type': 'application/json',
	}
}

async function requireOk(response: Response, context: string): Promise<void> {
	if (response.ok) return
	const body = await response.text()
	throw new Error(
		`${context}: Infisical API returned ${response.status}: ${body}`,
	)
}

/**
 * Trade a GitHub Actions OIDC token for a short-lived Infisical access token.
 * Infisical verifies the JWT against GitHub's public keys and the machine
 * identity's bound claims (audience, subject, `job_workflow_ref`), so a login
 * rejected here means the running workflow is not one the identity trusts.
 */
export async function loginInfisicalWithOidc(
	identityId: string,
	jwt: string,
): Promise<string> {
	const context = 'Infisical OIDC login'
	const response = await fetch(
		`${INFISICAL_API_BASE}/v1/auth/oidc-auth/login`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identityId, jwt }),
		},
	)
	await requireOk(response, context)

	const responseBody: unknown = await response.json()
	if (
		!isRecord(responseBody) ||
		typeof responseBody['accessToken'] !== 'string'
	) {
		throw new Error(`${context}: response is missing \`accessToken\``)
	}
	return responseBody['accessToken']
}

function parseSecretEntry(
	rawSecret: unknown,
	context: string,
): [string, string] {
	if (
		!isRecord(rawSecret) ||
		typeof rawSecret['secretKey'] !== 'string' ||
		typeof rawSecret['secretValue'] !== 'string'
	) {
		throw new Error(
			`${context}: a secret is missing \`secretKey\` or \`secretValue\``,
		)
	}
	return [rawSecret['secretKey'], rawSecret['secretValue']]
}

function parseSecrets(
	rawSecrets: unknown,
	context: string,
): Record<string, string> {
	if (!Array.isArray(rawSecrets)) {
		throw new Error(`${context}: \`secrets\` must be an array`)
	}
	return Object.fromEntries(
		rawSecrets.map(rawSecret => parseSecretEntry(rawSecret, context)),
	)
}

// Secrets a folder pulls in through Infisical imports (a `/shared` folder
// linked into several projects). Imports apply in order - a later import
// overrides an earlier one - and the folder's own secrets override them all.
function parseImportedSecrets(
	rawImports: unknown,
	context: string,
): Record<string, string> {
	if (typeof rawImports === 'undefined') return {}
	if (!Array.isArray(rawImports)) {
		throw new Error(`${context}: \`imports\` must be an array`)
	}
	return Object.assign(
		{},
		...rawImports.map(rawImport => {
			if (!isRecord(rawImport)) {
				throw new Error(`${context}: an import is not an object`)
			}
			return parseSecrets(rawImport['secrets'], context)
		}),
	)
}

async function listSecrets(
	session: InfisicalSession,
	path: string,
): Promise<Record<string, string>> {
	const context = `Infisical list secrets at "${path}"`
	const query = new URLSearchParams({
		projectId: session.projectId,
		environment: session.environment,
		secretPath: path,
	})
	const response = await fetch(
		`${INFISICAL_API_BASE}/v4/secrets?${query.toString()}`,
		{ headers: authHeaders(session.accessToken) },
	)
	if (response.status === HTTP_NOT_FOUND) {
		const body = await response.text()
		if (body.includes(SECRET_PATH_NOT_FOUND)) return {}
		throw new Error(`${context}: Infisical API returned 404: ${body}`)
	}
	await requireOk(response, context)

	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody)) {
		throw new Error(`${context}: response body is not an object`)
	}
	return {
		...parseImportedSecrets(responseBody['imports'], context),
		...parseSecrets(responseBody['secrets'], context),
	}
}

async function folderExists(
	session: InfisicalSession,
	parentPath: string,
	name: string,
): Promise<boolean> {
	const context = `Infisical list folders at "${parentPath}"`
	const query = new URLSearchParams({
		projectId: session.projectId,
		environment: session.environment,
		path: parentPath,
	})
	const response = await fetch(
		`${INFISICAL_API_BASE}/v2/folders?${query.toString()}`,
		{ headers: authHeaders(session.accessToken) },
	)
	await requireOk(response, context)

	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !Array.isArray(responseBody['folders'])) {
		throw new Error(`${context}: \`folders\` must be an array`)
	}
	return responseBody['folders'].some(
		folder => isRecord(folder) && folder['name'] === name,
	)
}

// Infisical refuses a write into a folder that does not exist, and creating a
// folder that already exists is an error - so check, then create. Missing
// parent folders are created by the same call.
async function ensureFolder(
	session: InfisicalSession,
	path: string,
): Promise<void> {
	if (path === ROOT_PATH) return
	const separatorIndex = path.lastIndexOf('/')
	const parentPath = path.slice(0, separatorIndex) || ROOT_PATH
	const name = path.slice(separatorIndex + 1)
	if (await folderExists(session, parentPath, name)) return

	const response = await fetch(`${INFISICAL_API_BASE}/v2/folders`, {
		method: 'POST',
		headers: authHeaders(session.accessToken),
		body: JSON.stringify({
			projectId: session.projectId,
			environment: session.environment,
			name,
			path: parentPath,
		}),
	})
	await requireOk(response, `Infisical create folder "${path}"`)
}

async function setSecrets(
	session: InfisicalSession,
	path: string,
	secrets: Readonly<Record<string, string>>,
): Promise<void> {
	await ensureFolder(session, path)
	const response = await fetch(`${INFISICAL_API_BASE}/v4/secrets/batch`, {
		method: 'PATCH',
		headers: authHeaders(session.accessToken),
		body: JSON.stringify({
			projectId: session.projectId,
			environment: session.environment,
			secretPath: path,
			mode: 'upsert',
			secrets: Object.entries(secrets).map(
				([secretKey, secretValue]) => ({
					secretKey,
					secretValue,
				}),
			),
		}),
	})
	await requireOk(response, `Infisical set secrets at "${path}"`)
}

export function createInfisicalVault(
	accessToken: string,
	location: InfisicalVaultLocation,
): SecretVault {
	const session: InfisicalSession = { ...location, accessToken }
	return {
		listSecrets: path => listSecrets(session, path),
		setSecrets: (path, secrets) => setSecrets(session, path, secrets),
	}
}
