import type { TerraformMainConfig } from './terraform-main-config.ts'

const PLANETSCALE_ROLE_TYPE = 'planetscale_postgres_branch_role'

/**
 * The PlanetScale roles a teardown applies before it destroys: those the
 * generated config declares and `stateAddresses` (the state) already holds. A
 * role created before `successor` was declared has none recorded, and the
 * provider reads the successor from the state when it drops the role, so a
 * role that owns tables would be refused. Applying it first records the
 * successor; a role absent from the state is not created to be destroyed.
 */
export function rolesToConvergeBeforeDestroy(
	mainConfig: TerraformMainConfig,
	stateAddresses: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const declared = Object.keys(
		mainConfig.resource?.planetscale_postgres_branch_role ?? {},
	).map(label => `${PLANETSCALE_ROLE_TYPE}.${label}`)
	return declared.filter(address => stateAddresses.includes(address))
}
