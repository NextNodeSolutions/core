import { isSecretGenerator } from '#/config/predicates.ts'
import { SECRET_GENERATORS } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import type {
	DeployTargetType,
	GeneratedSecretConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
const MIN_SECRET_LENGTH = 16
const MAX_SECRET_LENGTH = 256

const SECRETS_NOT_ARRAY = 'deploy.secrets must be an array'
const SECRET_ENTRY_INVALID =
	'deploy.secrets entries must be a non-empty secret name or a { name, generate, length } table'

type ParsedSecretEntry =
	| { readonly kind: 'error'; readonly message: string }
	| { readonly kind: 'name'; readonly name: string }
	| { readonly kind: 'generated'; readonly spec: GeneratedSecretConfig }

function parseGeneratedSecret(
	entry: Record<string, unknown>,
): ParsedSecretEntry {
	const { name } = entry
	if (typeof name !== 'string' || name === '') {
		return {
			kind: 'error',
			message:
				'deploy.secrets generated entry must declare a non-empty string `name`',
		}
	}
	const { generate } = entry
	if (!isSecretGenerator(generate)) {
		return {
			kind: 'error',
			message: `deploy.secrets entry "${name}" \`generate\` must be one of: ${SECRET_GENERATORS.join(', ')}`,
		}
	}
	const { length } = entry
	if (
		typeof length !== 'number' ||
		!Number.isInteger(length) ||
		length < MIN_SECRET_LENGTH ||
		length > MAX_SECRET_LENGTH
	) {
		return {
			kind: 'error',
			message: `deploy.secrets entry "${name}" \`length\` must be an integer between ${MIN_SECRET_LENGTH} and ${MAX_SECRET_LENGTH}`,
		}
	}
	return { kind: 'generated', spec: { name, generate, length } }
}

function parseSecretEntry(entry: unknown): ParsedSecretEntry {
	if (typeof entry === 'string') {
		if (entry === '')
			return { kind: 'error', message: SECRET_ENTRY_INVALID }
		return { kind: 'name', name: entry }
	}
	if (isRecord(entry)) return parseGeneratedSecret(entry)
	return { kind: 'error', message: SECRET_ENTRY_INVALID }
}
function parseSecretEntries(raw: unknown): {
	errors: string[]
	names: string[]
	generated: GeneratedSecretConfig[]
} {
	if (typeof raw === 'undefined')
		return { errors: [], names: [], generated: [] }
	if (!Array.isArray(raw)) {
		return { errors: [SECRETS_NOT_ARRAY], names: [], generated: [] }
	}

	const errors: string[] = []
	const names: string[] = []
	const generated: GeneratedSecretConfig[] = []
	const seen = new Set<string>()
	for (const entry of raw) {
		const parsed = parseSecretEntry(entry)
		if (parsed.kind === 'error') {
			errors.push(parsed.message)
			continue
		}
		const name = parsed.kind === 'name' ? parsed.name : parsed.spec.name
		if (seen.has(name)) {
			errors.push(`deploy.secrets declares "${name}" more than once`)
			continue
		}
		seen.add(name)
		names.push(name)
		if (parsed.kind === 'generated') generated.push(parsed.spec)
	}
	return { errors, names, generated }
}
function expandServiceSecrets<T extends { secrets: ReadonlyArray<string> }>(
	services: Record<string, T>,
	globalNames: ReadonlyArray<string>,
): Record<string, T> {
	if (!globalNames.length) return services
	return Object.fromEntries(
		Object.entries(services).map(([name, service]): [string, T] => [
			name,
			{
				...service,
				secrets: [...new Set([...globalNames, ...service.secrets])],
			},
		]),
	)
}

export interface ResolvedSecrets<T = WorkerServiceConfig> {
	errors: string[]
	secrets: ReadonlyArray<string>
	generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
	services: Record<string, T>
}
export function resolveSecrets<T extends { secrets: ReadonlyArray<string> }>(
	target: DeployTargetType,
	deployRecord: Record<string, unknown>,
	services: Record<string, T>,
): ResolvedSecrets<T> {
	void target
	const parsed = parseSecretEntries(deployRecord['secrets'])
	const expanded = expandServiceSecrets(services, parsed.names)
	const pool = new Set<string>(parsed.names)
	for (const service of Object.values(expanded)) {
		for (const secret of service.secrets) pool.add(secret)
	}
	return {
		errors: parsed.errors,
		secrets: [...pool],
		generatedSecrets: parsed.generated,
		services: expanded,
	}
}
