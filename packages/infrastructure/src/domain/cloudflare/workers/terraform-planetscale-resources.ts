import {
	computeHyperdriveConfigName,
	computePlanetscaleDatabaseName,
	PLANETSCALE_DEFAULT_BRANCH,
	PLANETSCALE_HYPERDRIVE_ROLE,
	PLANETSCALE_ORGANIZATION,
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
export const PLANETSCALE_LABEL = 'planetscale'

// The branch-role attributes the Hyperdrive origin interpolates. Named once so a
// provider attribute rename is a single edit.
const ROLE_REF = `planetscale_postgres_branch_role.${PLANETSCALE_LABEL}`

export function buildPlanetscaleBranchRole(
	derived: WorkersDerivedResources,
): Record<string, PlanetscaleBranchRoleResource> {
	return {
		[PLANETSCALE_LABEL]: {
			organization: PLANETSCALE_ORGANIZATION,
			database: computePlanetscaleDatabaseName(
				derived.projectName,
				derived.environment,
			),
			branch: PLANETSCALE_DEFAULT_BRANCH,
			name: PLANETSCALE_HYPERDRIVE_ROLE,
			inherited_roles: [...PLANETSCALE_ROLE_INHERITED_ROLES],
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
