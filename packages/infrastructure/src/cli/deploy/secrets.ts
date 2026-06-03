import { readJsonRecordEnv } from '#/cli/env.ts'

/**
 * Parse the `ALL_SECRETS` GitHub Secrets payload, or return `{}` if the
 * env var is absent. Used by every command that needs read access to
 * repository secrets — deploy threads them into the runtime env, provision
 * threads them into service factories that may need them later.
 */
export function readRepoSecrets(): Record<string, string> {
	return readJsonRecordEnv('ALL_SECRETS')
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
