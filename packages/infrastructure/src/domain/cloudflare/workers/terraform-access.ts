import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { toTerraformLabel } from './terraform-labels.ts'
import { ACCOUNT_ID_REF } from './terraform-refs.ts'

import type { OrganizationConfig } from '#/config/organization.ts'
import type {
	CloudflareWorkersDeployableConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { OutputValue } from './terraform-main-config.ts'

const ACCESS_POLICY_LABEL = 'internal'
const ACCESS_POLICY_PRECEDENCE = 1
export const ACCESS_AUDIENCES_OUTPUT = 'access_audiences'

export type AccessPolicyResource = {
	readonly account_id: string
	readonly name: string
	readonly decision: 'allow'
	readonly include: ReadonlyArray<{
		readonly email_domain: { readonly domain: string }
	}>
}

export type AccessApplicationResource = {
	readonly account_id: string
	readonly name: string
	readonly domain: string
	readonly type: 'self_hosted'
	readonly session_duration: string
	readonly policies: ReadonlyArray<{
		readonly id: string
		readonly precedence: number
	}>
}

// Config parsing resolves `internal` to false on a Worker without `url`, so
// every internal service carries the hostname its Access application guards.
function internalHosts(
	config: CloudflareWorkersDeployableConfig,
): ReadonlyArray<readonly [string, WorkerServiceConfig]> {
	return Object.entries(config.deploy.services).filter(
		([, service]) => service.internal,
	)
}

/**
 * The audience tag of each internal service's Access application, keyed by
 * service name. The Worker receives it as `ACCESS_AUD` to verify the Access JWT.
 */
export function buildAccessOutputs(
	config: CloudflareWorkersDeployableConfig,
): Record<string, OutputValue> {
	const hosts = internalHosts(config)
	if (!hosts.length) return {}
	return {
		[ACCESS_AUDIENCES_OUTPUT]: {
			value: Object.fromEntries(
				hosts.map(([name]) => [
					name,
					`\${cloudflare_zero_trust_access_application.${toTerraformLabel(name)}.aud}`,
				]),
			),
		},
	}
}

export function buildAccessResources(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
	access: OrganizationConfig['access'],
): {
	applications: Record<string, AccessApplicationResource>
	policies: Record<string, AccessPolicyResource>
} {
	const hosts = internalHosts(config)
	if (!hosts.length) return { applications: {}, policies: {} }
	if (!access)
		throw new Error('Internal Workers require organization Access settings')
	return {
		applications: Object.fromEntries(
			hosts.map(([name, service]) => [
				toTerraformLabel(name),
				{
					account_id: ACCOUNT_ID_REF,
					name: `${config.project.name}-${environment}-${name}`,
					domain: resolveDeployDomain(
						service.url ?? config.project.domain,
						environment,
					),
					type: 'self_hosted',
					session_duration: access.sessionDuration,
					policies: [
						{
							id: `\${cloudflare_zero_trust_access_policy.${ACCESS_POLICY_LABEL}.id}`,
							precedence: ACCESS_POLICY_PRECEDENCE,
						},
					],
				},
			]),
		),
		policies: {
			[ACCESS_POLICY_LABEL]: {
				account_id: ACCOUNT_ID_REF,
				name: `${config.project.name}-${environment}-internal`,
				decision: 'allow',
				include: [{ email_domain: { domain: access.emailDomain } }],
			},
		},
	}
}
