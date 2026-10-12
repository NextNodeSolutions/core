import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { toTerraformLabel } from './terraform-labels.ts'
import { ACCOUNT_ID_REF } from './terraform-refs.ts'

import type { OrganizationConfig } from '#/config/organization.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const ACCESS_POLICY_LABEL = 'internal'
const ACCESS_POLICY_PRECEDENCE = 1

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

export function buildAccessResources(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
	access: OrganizationConfig['access'],
): {
	applications: Record<string, AccessApplicationResource>
	policies: Record<string, AccessPolicyResource>
} {
	if (!config.project.internal) return { applications: {}, policies: {} }
	if (!access)
		throw new Error('Internal Workers require organization Access settings')
	const hosts = Object.entries(config.deploy.services).filter(
		([, service]) => service.url,
	)
	if (!hosts.length)
		throw new Error(
			'project.internal requires at least one routed Worker with a url',
		)
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
