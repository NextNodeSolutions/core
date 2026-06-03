import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

export function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} env var is required`)
	}
	return value
}

export function getEnv(name: string): string | undefined {
	return process.env[name]
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		isRecord(value) &&
		Object.values(value).every(v => typeof v === 'string')
	)
}

// Read an env var holding a JSON object of string values — the shape GitHub
// Actions emits for `toJSON(secrets)` / `toJSON(vars)`. Absent or empty → `{}`
// (a repo with no secrets/variables is valid; the consumer fails loud later if
// a specific key it needs is missing). A present-but-malformed payload throws.
export function readJsonRecordEnv(name: string): Record<string, string> {
	const raw = getEnv(name)
	if (raw === undefined || raw === '') return {}
	const parsed: unknown = parseJsonOrThrow(raw, name)
	if (!isStringRecord(parsed)) {
		throw new Error(`${name} must be a JSON object with string values`)
	}
	return parsed
}

export function requireB64Env(name: string): string {
	return Buffer.from(requireEnv(name), 'base64').toString('utf8')
}

export interface GithubRepository {
	readonly owner: string
	readonly name: string
}

export function requireGithubRepository(): GithubRepository {
	const value = requireEnv('GITHUB_REPOSITORY')
	const [owner, name] = value.split('/')
	if (!owner || !name) {
		throw new Error(
			`GITHUB_REPOSITORY must be in "owner/repo" format (got "${value}")`,
		)
	}
	return { owner, name }
}

// Unix env-var idiom: a variable is opt-in by presence, not by "true/false".
// Set TEARDOWN_WITH_VOLUMES=1 (or anything non-empty) to enable; leave it
// unset to disable. Same convention as CI, DEBUG, FORCE_COLOR.
export function isEnvSet(name: string): boolean {
	const raw = process.env[name]
	return raw !== undefined && raw !== ''
}

export function getEnumEnv<T extends string>(
	name: string,
	allowed: readonly T[],
	defaultValue: T,
): T {
	const raw = process.env[name]
	if (raw === undefined || raw === '') {
		return defaultValue
	}
	const match = allowed.find(value => value === raw)
	if (match === undefined) {
		throw new Error(
			`Invalid ${name} "${raw}" — expected one of: ${allowed.join(', ')}`,
		)
	}
	return match
}
