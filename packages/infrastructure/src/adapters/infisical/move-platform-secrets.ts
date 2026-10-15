import { isRecord } from '#/kernel/guards.ts'

import { INFISICAL_API_BASE, ROOT_PATH } from './vault.ts'

import type { InfisicalVaultLocation } from './vault.ts'

const SOURCE_PATH = '/ci'

type SecretMetadata = {
	readonly id: string
	readonly secretKey: string
}

function parseMetadata(secret: unknown): SecretMetadata {
	if (
		!isRecord(secret) ||
		typeof secret['id'] !== 'string' ||
		typeof secret['secretKey'] !== 'string'
	) {
		throw new Error('Infisical returned invalid secret metadata')
	}
	return { id: secret['id'], secretKey: secret['secretKey'] }
}

export async function movePlatformSecrets(
	accessToken: string,
	projectId: string,
	environment: string,
): Promise<void> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		'Content-Type': 'application/json',
	}
	const location = { projectId, environment }
	const list = async (secretPath: string): Promise<SecretMetadata[]> => {
		const query = new URLSearchParams({
			...location,
			secretPath,
			viewSecretValue: 'false',
			expandSecretReferences: 'false',
			includeImports: 'false',
			recursive: 'false',
		})
		const response = await fetch(
			`${INFISICAL_API_BASE}/v4/secrets?${query.toString()}`,
			{ headers },
		)
		if (!response.ok)
			throw new Error(
				`Infisical metadata read failed: HTTP ${response.status}`,
			)
		const payload: unknown = await response.json()
		if (!isRecord(payload) || !Array.isArray(payload['secrets'])) {
			throw new Error('Infisical metadata response has no secrets array')
		}
		return payload['secrets'].map(parseMetadata)
	}
	await moveAndVerify(list, headers, location)
}

async function moveAndVerify(
	list: (path: string) => Promise<SecretMetadata[]>,
	headers: Record<string, string>,
	location: InfisicalVaultLocation,
): Promise<void> {
	const source = await list(SOURCE_PATH)
	const destination = await list(ROOT_PATH)
	if (!source.length) throw new Error('No secrets in /ci; no changes made')
	const collisions = source.filter(secret =>
		destination.some(root => root.secretKey === secret.secretKey),
	)
	if (collisions.length) {
		throw new Error(
			`Root already contains: ${collisions.map(secret => secret.secretKey).join(', ')}; no changes made`,
		)
	}
	process.stdout.write(
		`Moving ${source.length} secrets: ${source.map(secret => secret.secretKey).join(', ')}\n`,
	)
	const response = await fetch(`${INFISICAL_API_BASE}/v4/secrets/move`, {
		method: 'POST',
		headers,
		body: JSON.stringify({
			projectId: location.projectId,
			sourceEnvironment: location.environment,
			destinationEnvironment: location.environment,
			sourceSecretPath: SOURCE_PATH,
			destinationSecretPath: ROOT_PATH,
			secretIds: source.map(secret => secret.id),
			shouldOverwrite: false,
		}),
	})
	if (!response.ok)
		throw new Error(`Infisical move failed: HTTP ${response.status}`)
	await verifyMove(list, [...source, ...destination])
}

async function verifyMove(
	list: (path: string) => Promise<SecretMetadata[]>,
	expected: readonly SecretMetadata[],
): Promise<void> {
	const remaining = await list(SOURCE_PATH)
	const root = await list(ROOT_PATH)
	if (
		remaining.length ||
		expected.some(
			secret => !root.some(entry => entry.secretKey === secret.secretKey),
		)
	) {
		throw new Error(
			'Move verification failed; inspect Infisical before retrying',
		)
	}
	process.stdout.write(
		`Verified / contains ${expected.length} expected keys, original root keys preserved, /ci empty\n`,
	)
}
