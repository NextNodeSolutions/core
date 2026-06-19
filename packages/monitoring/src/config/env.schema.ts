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
	TS_OAUTH_SECRET: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	R2_ACCESS_KEY_ID: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	R2_SECRET_ACCESS_KEY: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	NN_CLIENT_ID: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	GITHUB_TOKEN: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
	// Local-only switch: `MOCK_DATA=1` makes the upstream adapters serve canned
	// fixtures instead of hitting Hetzner / VictoriaMetrics / VictoriaLogs, so the
	// dashboard runs fully populated with no tokens and no tailnet. Off by default.
	MOCK_DATA: envField.string({
		context: 'server',
		access: 'secret',
		optional: true,
	}),
} as const
