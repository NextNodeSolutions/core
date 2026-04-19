const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/

export function formatComposeEnv(
	env: Readonly<Record<string, string>>,
): string {
	return Object.entries(env)
		.map(([key, value]) => {
			if (!ENV_KEY_PATTERN.test(key)) {
				throw new Error(
					`compose-env: invalid env var name "${key}" (must match ^[A-Z_][A-Z0-9_]*$)`,
				)
			}
			if (value.includes('\n') || value.includes('\r')) {
				throw new Error(
					`compose-env: value for "${key}" contains a newline — rejected to prevent .env injection`,
				)
			}
			return `${key}=${value}`
		})
		.join('\n')
}
