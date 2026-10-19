import {
	computeHyperdriveConfigName,
	computePlanetscaleDatabaseName,
	PLANETSCALE_DEFAULT_BRANCH,
	PLANETSCALE_HYPERDRIVE_ROLE,
	PLANETSCALE_POSTGRES_PORT,
	PLANETSCALE_POSTGRES_SCHEME,
	PLANETSCALE_ROLE_INHERITED_ROLES,
} from './planetscale.ts'
import { ACCOUNT_ID_REF } from './terraform-refs.ts'

import type {
	HyperdriveConfigResource,
	PlanetscaleBranchRoleResource,
} from './terraform-main-config.ts'
import type { WorkersDerivedResources } from './terraform-resources.ts'

// The single Terraform label both PlanetScale resources use - one branch-role +
// one Hyperdrive config per project (one Postgres DB, like the single D1).
const PLANETSCALE_LABEL = 'planetscale'

// The branch-role attributes the Hyperdrive origin interpolates. Named once so a
// provider attribute rename is a single edit.
const PLANETSCALE_MIGRATOR_LABEL = 'migrator'
export const PLANETSCALE_MIGRATOR_REF = `planetscale_postgres_branch_role.${PLANETSCALE_MIGRATOR_LABEL}`

const ROLE_REF = `planetscale_postgres_branch_role.${PLANETSCALE_LABEL}`

export function buildPlanetscaleBranchRole(
	derived: WorkersDerivedResources,
	organization: string | undefined,
): Record<string, PlanetscaleBranchRoleResource> {
	if (!organization)
		throw new Error(
			'PlanetScale organization is required when the service is declared',
		)
	return {
		[PLANETSCALE_LABEL]: {
			organization,
			database: computePlanetscaleDatabaseName(
				derived.projectName,
				derived.environment,
			),
			branch: PLANETSCALE_DEFAULT_BRANCH,
			name: PLANETSCALE_HYPERDRIVE_ROLE,
			inherited_roles: [...PLANETSCALE_ROLE_INHERITED_ROLES],
		},
		[PLANETSCALE_MIGRATOR_LABEL]: {
			organization,
			database: computePlanetscaleDatabaseName(
				derived.projectName,
				derived.environment,
			),
			branch: PLANETSCALE_DEFAULT_BRANCH,
			name: PLANETSCALE_MIGRATOR_LABEL,
			inherited_roles: ['postgres'],
		},
	}
}

export function buildHyperdriveConfig(
	derived: WorkersDerivedResources,
): Record<string, HyperdriveConfigResource> {
	return {
		[PLANETSCALE_LABEL]: {
			account_id: ACCOUNT_ID_REF,
			name: computeHyperdriveConfigName(
				derived.projectName,
				derived.environment,
			),
			origin: {
				scheme: PLANETSCALE_POSTGRES_SCHEME,
				host: `\${${ROLE_REF}.access_host_url}`,
				port: PLANETSCALE_POSTGRES_PORT,
				database: `\${${ROLE_REF}.database_name}`,
				user: `\${${ROLE_REF}.username}`,
				password: `\${${ROLE_REF}.password}`,
			},
		},
	}
}
