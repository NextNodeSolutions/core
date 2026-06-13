import {
	HEALTHCHECKS_PING_URL_SECRET,
	RESEND_API_KEY_SECRET,
} from '#/domain/monitoring/alertmanager-config.ts'
import { buildObservabilityDeployFiles } from '#/domain/monitoring/observability-files.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { UserServiceConfig } from '#/config/types.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

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
		if (service.url === undefined) continue
		const port = input.hostPorts[name]
		if (port === undefined) {
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
 * RESEND_API_KEY must exist in the secret pool - alerting without a
 * notification channel is the silent failure this stack exists to
 * prevent. HEALTHCHECKS_PING_URL is optional until the operator creates
 * the external check.
 */
export async function writeObservabilityFiles(
	session: SshSession,
	envDir: string,
	input: ObservabilityRolloutInput,
): Promise<void> {
	const resendApiKey = input.secrets[RESEND_API_KEY_SECRET]
	if (resendApiKey === undefined || resendApiKey === '') {
		throw new Error(
			`observability: "${RESEND_API_KEY_SECRET}" must be defined in the [deploy].secrets pool - Alertmanager cannot route email without it`,
		)
	}
	const healthchecksPingUrl = input.secrets[HEALTHCHECKS_PING_URL_SECRET]

	const files = buildObservabilityDeployFiles({
		appHostPort: selectSdAppHostPort(input),
		tailnetIp: input.tailnetIp,
		projectName: input.projectName,
		environment: input.environment,
		vpsName: input.vpsName,
		clientId: input.clientId,
		resendApiKey,
		healthchecksPingUrl:
			healthchecksPingUrl === '' ? undefined : healthchecksPingUrl,
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
