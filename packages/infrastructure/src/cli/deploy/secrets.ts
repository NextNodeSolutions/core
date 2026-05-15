import { getEnv } from '#/cli/env.ts'

function isStringRecord(value: unknown): value is Record<string, string> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false
	}
	return Object.values(value).every(v => typeof v === 'string')
}

/**
 * Parse the `ALL_SECRETS` GitHub Secrets payload, or return `{}` if the
 * env var is absent. Used by every command that needs read access to
 * repository secrets — deploy threads them into the runtime env, provision
 * threads them into service factories that may need them later.
 */
export function readRepoSecrets(): Record<string, string> {
	const raw = getEnv('ALL_SECRETS')
	if (raw === undefined || raw === '') return {}
	const parsed: unknown = JSON.parse(raw)
	if (!isStringRecord(parsed)) {
		throw new Error('ALL_SECRETS must be a JSON object with string values')
	}
	return parsed
}

export function pickSecrets(
	repoSecrets: Readonly<Record<string, string>>,
	names: ReadonlyArray<string>,
): Record<string, string> {
	const picked: Record<string, string> = {}

	for (const name of names) {
		const value = repoSecrets[name]
		if (value === undefined) {
			throw new Error(
				`Secret "${name}" declared in deploy.secrets but not found in GitHub Secrets`,
			)
		}
		picked[name] = value
	}

	return picked
}
