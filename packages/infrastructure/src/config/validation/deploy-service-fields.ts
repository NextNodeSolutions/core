import { boolean, optional } from 'valibot'

import { REMOVED_SECRETS_FIELD_REASON } from './deploy-removed-fields.ts'
import {
	toWorkerFirewall,
	workerFirewallFields,
} from './deploy-worker-firewall.ts'
import { forbiddenField, optionalNonEmpty, stringArray } from './valibot.ts'

import type { DeployServiceBase, ProjectSection } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ParsedWorkerFirewall } from './deploy-worker-firewall.ts'

// The fields every [deploy.services.<name>] shares, Worker or container. Both
// schemas spread them, so a field means the same thing and fails with the same
// message whichever kind declares it.
export type ParsedServiceBase = ParsedWorkerFirewall & {
	url?: string | undefined
	internal?: boolean | undefined
	secrets?: undefined
	needs: string[]
	depends_on: string[]
	observability: boolean
}

type ServiceBaseFields = ReturnType<typeof workerFirewallFields> & {
	url: GenericSchema<unknown, string | undefined>
	internal: GenericSchema<unknown, boolean | undefined>
	secrets: GenericSchema<unknown, undefined>
	needs: GenericSchema<unknown, string[]>
	depends_on: GenericSchema<unknown, string[]>
	observability: GenericSchema<unknown, boolean>
}

export const serviceBaseFields = (name: string): ServiceBaseFields => ({
	url: optionalNonEmpty(
		`deploy.services.${name}.url must be a non-empty string`,
	),
	// Puts this routed service behind Cloudflare Access, or keeps it public
	// in an internal project: overrides `project.internal` either way.
	internal: optional(
		boolean(`deploy.services.${name}.internal must be a boolean`),
	),
	secrets: forbiddenField(
		`deploy.services.${name}.secrets is not supported: ${REMOVED_SECRETS_FIELD_REASON}`,
	),
	needs: stringArray(
		`deploy.services.${name}.needs must be an array of strings`,
		`deploy.services.${name}.needs entries must be non-empty strings`,
	),
	depends_on: stringArray(
		`deploy.services.${name}.depends_on must be an array of strings`,
		`deploy.services.${name}.depends_on entries must be non-empty strings`,
	),
	// Workers Logs default on: a silent-by-default Worker retains no
	// invocation logs and is a debugging trap. Opt out with
	// `observability = false` on high-traffic Workers where the
	// 20M-events/month Paid allowance is a concern.
	observability: optional(
		boolean(`deploy.services.${name}.observability must be a boolean`),
		true,
	),
	...workerFirewallFields(name),
})

// Fields the container era of nextnode.toml carried that no service kind
// accepts any more. Rejected rather than ignored, so a leftover is not
// mistaken for a setting.
export const LEGACY_IMAGE_FIELD_REASONS: Readonly<Record<string, string>> = {
	dockerfile:
		'the Dockerfile path is `image` - rename `dockerfile` to `image`',
	target: 'Docker build stages are not supported - drop `target`',
	build_args:
		'Docker build arguments are not supported (a runtime value is an Infisical secret or a public var) - drop `build_args`',
	source: 'core builds the image from the `image` Dockerfile and pulls nothing - drop `source`',
	ref: 'core builds the image from the `image` Dockerfile and pulls nothing - drop `ref`',
	registry_auth_secret:
		'core pushes to the Cloudflare registry with the deploy credentials - drop `registry_auth_secret`',
}

// One `forbiddenField` per entry of `reasons`, each message naming the service,
// the field, the kind that refuses it and why.
export const forbiddenServiceFields = (
	name: string,
	kindLabel: string,
	reasons: Readonly<Record<string, string>>,
): Record<string, GenericSchema<unknown, undefined>> =>
	Object.fromEntries(
		Object.entries(reasons).map(([field, why]) => [
			field,
			forbiddenField(
				`deploy.services.${name}.${field} is not supported on a ${kindLabel} service: ${why}`,
			),
		]),
	)

type MutableServiceBase = {
	-readonly [K in keyof DeployServiceBase]: DeployServiceBase[K]
}

export function toServiceBase(
	parsed: ParsedServiceBase,
	project: Pick<ProjectSection, 'internal'>,
): DeployServiceBase {
	const base: MutableServiceBase = {
		internal: Boolean(parsed.url) && (parsed.internal ?? project.internal),
		needs: parsed.needs,
		dependsOn: parsed.depends_on,
		observability: parsed.observability,
		...toWorkerFirewall(parsed),
	}
	if (parsed.url) base.url = parsed.url
	return base
}

export function internalWithoutUrlError(
	name: string,
	parsed: Pick<ParsedServiceBase, 'internal' | 'url'>,
): string | undefined {
	if (!parsed.internal || parsed.url) return undefined
	return `deploy.services.${name}: \`internal = true\` requires \`url\` - Access protects a hostname, and a service without one is reachable only through service bindings`
}
