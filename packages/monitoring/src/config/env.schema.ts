import { envField } from 'astro/config'

// All entries are optional so one missing token doesn't crash the server at
// startup; pages surface a "missing config" state via requireEnv instead.
export const envSchema = {
	CLOUDFLARE_API_TOKEN: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	CLOUDFLARE_ACCOUNT_ID: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	HETZNER_API_TOKEN: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
} as const
