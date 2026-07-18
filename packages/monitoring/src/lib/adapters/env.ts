import { getSecret } from 'astro:env/server'

export const ENV_KEYS = {
	CLOUDFLARE_API_TOKEN: 'CLOUDFLARE_API_TOKEN',
	CLOUDFLARE_ACCOUNT_ID: 'CLOUDFLARE_ACCOUNT_ID',
	HETZNER_API_TOKEN: 'HETZNER_API_TOKEN',
	TS_OAUTH_SECRET: 'TS_OAUTH_SECRET',
	R2_ACCESS_KEY_ID: 'R2_ACCESS_KEY_ID',
	R2_SECRET_ACCESS_KEY: 'R2_SECRET_ACCESS_KEY',
	NN_CLIENT_ID: 'NN_CLIENT_ID',
	// Runtime GitHub auth: the NextNode GitHub App mints installation
	// tokens (app-token.ts). The key travels base64-encoded because the
	// deploy env writer rejects multiline values. GH_API_TOKEN is an
	// optional local-dev PAT override (a GITHUB_-prefixed name is reserved
	// in GitHub Secrets, hence no GITHUB_TOKEN).
	NEXTNODE_APP_ID: 'NEXTNODE_APP_ID',
	NEXTNODE_APP_PRIVATE_KEY_B64: 'NEXTNODE_APP_PRIVATE_KEY_B64',
	GH_API_TOKEN: 'GH_API_TOKEN',
} as const

export class MissingEnvError extends Error {
	constructor(public readonly varName: string) {
		super(`Missing required env var: ${varName}`)
		this.name = 'MissingEnvError'
	}
}

export const getEnv = (name: string): string | undefined => {
	const secret = getSecret(name)
	return secret && secret.length > 0 ? secret : undefined
}

export const requireEnv = (name: string): string => {
	const secret = getEnv(name)
	if (!secret) throw new MissingEnvError(name)
	return secret
}
