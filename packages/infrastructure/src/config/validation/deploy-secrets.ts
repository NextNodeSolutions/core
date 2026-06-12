import { isSecretGenerator, SECRET_GENERATORS } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import type {
	DeployTargetType,
	GeneratedSecretConfig,
	UserServiceConfig,
} from '#/config/types.ts'

// `[deploy].secrets` entries are either a bare NAME (a must-exist GitHub secret)
// or a `{ name, generate, length }` table (the infra generates + pushes it at
// provision). `length` is the produced secret's CHARACTER count.
const MIN_SECRET_LENGTH = 8
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

// Parse `[deploy].secrets` into the flat NAME pool (every entry's name, for
// pickSecrets) and the generation specs (the table entries, for provisioning).
// Duplicate names are rejected - a name declared twice is an ambiguous source.
function parseSecretEntries(raw: unknown): {
	errors: string[]
	names: string[]
	generated: GeneratedSecretConfig[]
} {
	if (raw === undefined) return { errors: [], names: [], generated: [] }
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

// Fold the GLOBAL `[deploy].secrets` names into every service's own `secrets`
// (global ∪ own, deduped, global-first) so the per-service routing in
// `service-env.ts` - which keys off `service.secrets` - injects a global secret
// into every `.env.<service>` without any further wiring. No-op when there are
// no globals.
function expandServiceSecrets(
	services: Record<string, UserServiceConfig>,
	globalNames: ReadonlyArray<string>,
): Record<string, UserServiceConfig> {
	if (globalNames.length === 0) return services
	return Object.fromEntries(
		Object.entries(services).map(
			([name, service]): [string, UserServiceConfig] => [
				name,
				{
					...service,
					secrets: [...new Set([...globalNames, ...service.secrets])],
				},
			],
		),
	)
}

export interface ResolvedSecrets {
	errors: string[]
	secrets: ReadonlyArray<string>
	generatedSecrets: ReadonlyArray<GeneratedSecretConfig>
	services: Record<string, UserServiceConfig>
}

// Resolve the secret pool - the set of GitHub Secret NAMES the pipeline pulls
// for this deploy - and the generation specs, per target:
//   - cloudflare-pages parses [deploy].secrets directly: one deployable unit,
//     no per-service split, so the pool IS the declared list.
//   - hetzner-vps treats [deploy].secrets as the GLOBAL pool (injected into
//     every service via `expandServiceSecrets`) and the pool is that union with
//     each service's own per-service (least-privilege) secrets.
// Either way a `{ name, generate, length }` entry contributes its name to the
// pool and its spec to `generatedSecrets`. A name declared but absent from
// GitHub Secrets still fails loud at deploy time in `pickSecrets`.
export function resolveSecrets(
	target: DeployTargetType,
	deployRecord: Record<string, unknown>,
	services: Record<string, UserServiceConfig>,
): ResolvedSecrets {
	const parsed = parseSecretEntries(deployRecord['secrets'])
	if (target !== 'hetzner-vps') {
		return {
			errors: parsed.errors,
			secrets: parsed.names,
			generatedSecrets: parsed.generated,
			services,
		}
	}

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
