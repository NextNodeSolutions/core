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
