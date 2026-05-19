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

export function requireB64Env(name: string): string {
	return Buffer.from(requireEnv(name), 'base64').toString('utf8')
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
