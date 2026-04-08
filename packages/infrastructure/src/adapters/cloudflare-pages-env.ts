import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	formatErrors,
	parseEnvelope,
	requireOk,
} from './cloudflare-api.ts'

interface PlainEnvVar {
	readonly type: 'plain_text'
	readonly value: string
}

interface SecretEnvVar {
	readonly type: 'secret_text'
	readonly value: string
}

type EnvVarEntry = PlainEnvVar | SecretEnvVar

function buildPayload(
	computed: Readonly<Record<string, string>>,
	secrets: Readonly<Record<string, string>>,
): Record<string, EnvVarEntry> {
	const envVars: Record<string, EnvVarEntry> = {}

	for (const [key, value] of Object.entries(computed)) {
		envVars[key] = { type: 'plain_text', value }
	}
	for (const [key, value] of Object.entries(secrets)) {
		envVars[key] = { type: 'secret_text', value }
	}

	return envVars
}

/**
 * Set environment variables on a Cloudflare Pages project's production
 * deployment config.
 *
 * Computed values (SITE_URL) are set as plain_text (visible in dashboard).
 * Secrets (RESEND_API_KEY) are set as secret_text (write-only, encrypted).
 *
 * This PATCH merges with existing env vars — keys not included in the
 * payload are left untouched.
 */
export async function updatePagesEnvVars(
	accountId: string,
	projectName: string,
	token: string,
	computed: Readonly<Record<string, string>>,
	secrets: Readonly<Record<string, string>>,
): Promise<void> {
	const envVars = buildPayload(computed, secrets)

	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}`,
		{
			method: 'PATCH',
			headers: authHeaders(token),
			body: JSON.stringify({
				deployment_configs: {
					production: { env_vars: envVars },
				},
			}),
		},
	)
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare Pages env vars update for "${projectName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}
}
