import {
	buildPlanetscaleDatabaseUrl,
	PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
	PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
} from './planetscale.ts'
import { R2_S3_ACCESS_KEY_ID_OUTPUT } from './terraform-r2-credentials.ts'

import type { ContainerPostgresRole } from '#/config/container-service.ts'
import type { ContainerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from './outputs-env.ts'
import type { PlanetscaleRoleCredentials } from './planetscale.ts'

type RoleOutputs = Pick<
	WorkersTerraformOutputs,
	'planetscaleRuntime' | 'planetscaleMigrator'
>

type BackingOutputs = RoleOutputs &
	Pick<WorkersTerraformOutputs, 'r2Buckets' | 'r2S3Credentials'>

// The names the S3 SDKs and the Strapi aws-s3 provider configs read.
const R2_ACCESS_KEY_ID_SECRET = 'R2_ACCESS_KEY_ID'
const R2_SECRET_ACCESS_KEY_SECRET = 'R2_SECRET_ACCESS_KEY'

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

function databaseSecrets(
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

// A project without buckets has nothing to sign for: Terraform creates the
// token only when a container needs r2 and a bucket exists.
function r2Secrets(
	service: Pick<ContainerServiceConfig, 'needs'>,
	outputs: Pick<WorkersTerraformOutputs, 'r2Buckets' | 'r2S3Credentials'>,
): Readonly<Record<string, string>> {
	if (!service.needs.includes('r2') || !Object.keys(outputs.r2Buckets).length)
		return {}
	if (!outputs.r2S3Credentials) {
		throw new Error(
			`terraform output "${R2_S3_ACCESS_KEY_ID_OUTPUT}" is missing but a container service needs r2 - run \`infrastructure provision\` before deploy so Terraform creates its R2 token.`,
		)
	}
	return {
		[R2_ACCESS_KEY_ID_SECRET]: outputs.r2S3Credentials.accessKeyId,
		[R2_SECRET_ACCESS_KEY_SECRET]: outputs.r2S3Credentials.secretAccessKey,
	}
}

/**
 * The secrets core itself gives a container. `DATABASE_URL` for the
 * PlanetScale role the service declares (`postgresRole`, set when it needs
 * PlanetScale). `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` when it needs r2,
 * from the token Terraform scopes to the project's buckets. A Worker gets
 * neither: it reaches Postgres through Hyperdrive and R2 through bindings.
 */
export function buildContainerBackingSecrets(
	service: Pick<ContainerServiceConfig, 'postgresRole' | 'needs'>,
	outputs: BackingOutputs,
): Readonly<Record<string, string>> {
	return {
		...databaseSecrets(service, outputs),
		...r2Secrets(service, outputs),
	}
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
