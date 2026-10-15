import { isRecord } from '#/kernel/guards.ts'

import type { SecretVault, VaultProject } from '#/domain/vault/secret-vault.ts'

const INFISICAL_API_BASE = 'https://app.infisical.com/api'
// Secrets are read and written at the root of a project environment: the
// pipeline knows no folder.
const ROOT_PATH = '/'
// The Infisical product the pipeline's projects belong to (the same API also
// lists certificate and KMS projects).
const SECRET_MANAGER_PROJECT_TYPE = 'secret-manager'

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

function parseProject(rawProject: unknown, context: string): VaultProject {
	if (
		!isRecord(rawProject) ||
		typeof rawProject['id'] !== 'string' ||
		typeof rawProject['name'] !== 'string'
	) {
		throw new Error(`${context}: a project is missing \`id\` or \`name\``)
	}
	return { id: rawProject['id'], name: rawProject['name'] }
}

/**
 * The secret-manager projects the identity is a member of. Membership is the
 * whole filter: a project the identity was never added to is not listed, and
 * not readable.
 */
export async function listInfisicalProjects(
	accessToken: string,
): Promise<ReadonlyArray<VaultProject>> {
	const context = 'Infisical list projects'
	const query = new URLSearchParams({ type: SECRET_MANAGER_PROJECT_TYPE })
	const response = await fetch(
		`${INFISICAL_API_BASE}/v1/workspace?${query.toString()}`,
		{ headers: authHeaders(accessToken) },
	)
	await requireOk(response, context)

	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || !Array.isArray(responseBody['workspaces'])) {
		throw new Error(`${context}: \`workspaces\` must be an array`)
	}
	return responseBody['workspaces'].map(rawProject =>
		parseProject(rawProject, context),
	)
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

// Secrets a project pulls in through Infisical imports (a folder of another
// project linked in). Imports apply in order - a later import overrides an
// earlier one - and the project's own secrets override them all.
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
): Promise<Record<string, string>> {
	const context = `Infisical list secrets (project ${session.projectId}, environment "${session.environment}")`
	const query = new URLSearchParams({
		projectId: session.projectId,
		environment: session.environment,
		secretPath: ROOT_PATH,
	})
	const response = await fetch(
		`${INFISICAL_API_BASE}/v4/secrets?${query.toString()}`,
		{ headers: authHeaders(session.accessToken) },
	)
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

async function setSecrets(
	session: InfisicalSession,
	secrets: Readonly<Record<string, string>>,
): Promise<void> {
	const response = await fetch(`${INFISICAL_API_BASE}/v4/secrets/batch`, {
		method: 'PATCH',
		headers: authHeaders(session.accessToken),
		body: JSON.stringify({
			projectId: session.projectId,
			environment: session.environment,
			secretPath: ROOT_PATH,
			mode: 'upsert',
			secrets: Object.entries(secrets).map(
				([secretKey, secretValue]) => ({
					secretKey,
					secretValue,
				}),
			),
		}),
	})
	await requireOk(
		response,
		`Infisical set secrets (project ${session.projectId}, environment "${session.environment}")`,
	)
}

export function createInfisicalVault(
	accessToken: string,
	location: InfisicalVaultLocation,
): SecretVault {
	const session: InfisicalSession = { ...location, accessToken }
	return {
		listSecrets: () => listSecrets(session),
		setSecrets: secrets => setSecrets(session, secrets),
	}
}
