import {
	HEALTHCHECKS_PING_URL_SECRET,
	RESEND_API_KEY_SECRET,
} from '#/domain/monitoring/alertmanager-config.ts'
import { buildObservabilityDeployFiles } from '#/domain/monitoring/observability-files.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { UserServiceConfig } from '#/config/types.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

function nonEmptySecret(secret: string | undefined): string | undefined {
	if (!secret) return undefined
	return secret
}

export interface ObservabilityRolloutInput {
	readonly services: Readonly<Record<string, UserServiceConfig>>
	readonly hostPorts: Readonly<Record<string, number>>
	readonly secrets: Readonly<Record<string, string>>
	readonly tailnetIp: string
	readonly vpsName: string
	readonly projectName: string
	readonly environment: string
	readonly clientId: string | undefined
}

/**
 * Loopback host port of the service the observability stack joins for
 * service discovery: the first declared service with a `url` (the
 * primary routed app - for the monitoring project, the Astro control
 * plane serving /api/sd/*). Fail loud when the project declares
 * observability but routes nothing - the SD endpoint would not exist.
 */
function selectSdAppHostPort(input: ObservabilityRolloutInput): number {
	for (const [name, service] of Object.entries(input.services)) {
		if (typeof service.url === 'undefined') continue
		const port = input.hostPorts[name]
		if (typeof port === 'undefined') {
			throw new Error(
				`observability: routed service "${name}" has no allocated host port`,
			)
		}
		return port
	}
	throw new Error(
		'observability: the project declares [services.observability] but no [deploy.services.*] entry has a url - the SD endpoint needs a routed app service',
	)
}

/**
 * Write the rendered observability configs (vmagent scrape config, rule
 * files, alertmanager routing, blackbox modules) next to compose.yaml.
 * RESEND_API_KEY and HEALTHCHECKS_PING_URL are both optional: the stack
 * deploys (dashboards + scraping work) before any notification channel is
 * wired, and the Alertmanager renderer omits the email / dead-man routes when
 * their secret is absent. Set the secret + redeploy to turn each channel on.
 */
export async function writeObservabilityFiles(
	session: SshSession,
	envDir: string,
	input: ObservabilityRolloutInput,
): Promise<void> {
	const files = buildObservabilityDeployFiles({
		appHostPort: selectSdAppHostPort(input),
		tailnetIp: input.tailnetIp,
		projectName: input.projectName,
		environment: input.environment,
		vpsName: input.vpsName,
		clientId: input.clientId,
		resendApiKey: nonEmptySecret(input.secrets[RESEND_API_KEY_SECRET]),
		healthchecksPingUrl: nonEmptySecret(
			input.secrets[HEALTHCHECKS_PING_URL_SECRET],
		),
	})

	await Promise.all(
		Object.entries(files).map(([filename, content]) =>
			session.writeFile(`${envDir}/${filename}`, content),
		),
	)
	logger.info(
		`Observability configs written (${String(Object.keys(files).length)} file(s))`,
	)
}
