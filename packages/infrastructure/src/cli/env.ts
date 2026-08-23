import { parseJsonOrThrow } from '#/kernel/json.ts'
import { custom, pipe, record, safeParse, string } from 'valibot'

const STRING_RECORD_SCHEMA = pipe(
	custom(input => !Array.isArray(input)),
	record(string(), string()),
)

export function requireEnv(name: string): string {
	const rawEnv = process.env[name]
	if (!rawEnv) {
		throw new Error(`${name} env var is required`)
	}
	return rawEnv
}

export function getEnv(name: string): string | undefined {
	return process.env[name]
}

// Read an env var holding a JSON object of string values - the shape GitHub
// Actions emits for `toJSON(secrets)` / `toJSON(vars)`. Absent or empty → `{}`
// (a repo with no secrets/variables is valid; the consumer fails loud later if
// a specific key it needs is missing). A present-but-malformed payload throws.
export function readJsonRecordEnv(name: string): Record<string, string> {
	const raw = getEnv(name)
	if (!raw) return {}
	const parsed = parseJsonOrThrow(raw, name)
	const parsedRecord = safeParse(STRING_RECORD_SCHEMA, parsed)
	if (!parsedRecord.success) {
		throw new Error(`${name} must be a JSON object with string values`)
	}
	return parsedRecord.output
}

export function requireB64Env(name: string): string {
	return Buffer.from(requireEnv(name), 'base64').toString('utf8')
}

export interface GithubRepository {
	readonly owner: string
	readonly name: string
}

export function requireGithubRepository(): GithubRepository {
	const repository = requireEnv('GITHUB_REPOSITORY')
	const [owner, name] = repository.split('/')
	if (!owner || !name) {
		throw new Error(
			`GITHUB_REPOSITORY must be in "owner/repo" format (got "${repository}")`,
		)
	}
	return { owner, name }
}

// Unix env-var idiom: a variable is opt-in by presence, not by "true/false".
// Set TEARDOWN_WITH_VOLUMES=1 (or anything non-empty) to enable; leave it
// unset to disable. Same convention as CI, DEBUG, FORCE_COLOR.
export function isEnvSet(name: string): boolean {
	const raw = process.env[name]
	return Boolean(raw)
}

export function getEnumEnv<T extends string>(
	name: string,
	allowed: readonly T[],
	defaultValue: T,
): T {
	const raw = process.env[name]
	if (!raw) {
		return defaultValue
	}
	const match = allowed.find(candidate => candidate === raw)
	if (typeof match === 'undefined') {
		throw new Error(
			`Invalid ${name} "${raw}" - expected one of: ${allowed.join(', ')}`,
		)
	}
	return match
}
