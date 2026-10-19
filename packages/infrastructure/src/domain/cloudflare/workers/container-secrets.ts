import {
	buildPlanetscaleDatabaseUrl,
	PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
	PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
} from './planetscale.ts'

import type { ContainerPostgresRole } from '#/config/container-service.ts'
import type { ContainerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from './outputs-env.ts'
import type { PlanetscaleRoleCredentials } from './planetscale.ts'

type RoleOutputs = Pick<
	WorkersTerraformOutputs,
	'planetscaleRuntime' | 'planetscaleMigrator'
>

interface RoleSource {
	readonly outputPrefix: string
	readonly credentials: (
		outputs: RoleOutputs,
	) => PlanetscaleRoleCredentials | undefined
}

// Where each role's credentials come from: the runtime role's outputs exist
// only when a container uses it, the migrator's for every PlanetScale project.
const ROLE_SOURCES: Readonly<Record<ContainerPostgresRole, RoleSource>> = {
	runtime: {
		outputPrefix: PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
		credentials: outputs => outputs.planetscaleRuntime,
	},
	migrator: {
		outputPrefix: PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
		credentials: outputs => outputs.planetscaleMigrator,
	},
}

/**
 * The secrets core itself gives a container: `DATABASE_URL` for the
 * PlanetScale role the service declares (`postgresRole`, set when it needs
 * PlanetScale). A Worker never gets it: it reaches Postgres through its
 * Hyperdrive binding, and the URL is built only on this path.
 */
export function buildContainerBackingSecrets(
	service: Pick<ContainerServiceConfig, 'postgresRole'>,
	outputs: RoleOutputs,
): Readonly<Record<string, string>> {
	if (typeof service.postgresRole === 'undefined') return {}
	const source = ROLE_SOURCES[service.postgresRole]
	const credentials = source.credentials(outputs)
	if (!credentials) {
		throw new Error(
			`terraform output "${source.outputPrefix}_host" is missing but a container service connects as the ${service.postgresRole} role - run \`infrastructure provision\` before deploy so Terraform emits its credentials.`,
		)
	}
	return { DATABASE_URL: buildPlanetscaleDatabaseUrl(credentials) }
}

/**
 * The exact secret set of a container's gateway: the repository's Infisical
 * secrets plus the backing secrets. Undefined (the gateway keeps what it holds)
 * only when there is neither an Infisical project nor a backing secret. A name
 * claimed by both sources throws instead of letting one silently win.
 */
export function resolveContainerSecrets(
	projectSecrets: Readonly<Record<string, string>> | undefined,
	backingSecrets: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined {
	const backingNames = Object.keys(backingSecrets)
	if (!projectSecrets && !backingNames.length) return undefined
	const clashing = backingNames.filter(name =>
		Object.hasOwn(projectSecrets ?? {}, name),
	)
	if (clashing.length) {
		throw new Error(
			`the repository's Infisical project defines ${clashing.join(', ')}, which core sets on a container service from its backing services - remove it from Infisical`,
		)
	}
	return { ...projectSecrets, ...backingSecrets }
}
