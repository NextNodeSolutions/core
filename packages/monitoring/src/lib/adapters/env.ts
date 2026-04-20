export const ENV_KEYS = {
	CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_API_TOKEN',
	CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID',
	HETZNER_API_TOKEN: 'HETZNER_API_TOKEN',
} as const

export class MissingEnvError extends Error {
	constructor(public readonly varName: string) {
		super(`Missing required env var: ${varName}`)
		this.name = 'MissingEnvError'
	}
}

export const getEnv = (name: string): string | undefined => {
	const value = process.env[name]
	return value && value.length > 0 ? value : undefined
}

export const requireEnv = (name: string): string => {
	const value = getEnv(name)
	if (!value) throw new MissingEnvError(name)
	return value
}
