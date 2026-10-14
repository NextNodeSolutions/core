import { ensureHcpWorkspace } from '#/adapters/hcp/workspaces.ts'
import { WORKERS_MANAGED_RESOURCES } from '#/domain/cloudflare/workers/managed-resources.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'

import { provisionPlanetscaleDatabase } from './provision-planetscale.ts'
import { applyWorkersTerraform } from './terraform-ops.ts'

import type { OrganizationConfig } from '#/config/organization.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { WorkersResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersTerraformContext } from './terraform-ops.ts'

export interface WorkersProvisionInput {
	readonly organization: OrganizationConfig
	readonly workspaceName: string
	readonly projectName: string
	readonly hcpToken: string
	readonly config: CloudflareWorkersDeployableConfig
	readonly environment: AppEnvironment
	readonly planetscaleServiceTokenId: string | undefined
	readonly planetscaleServiceToken: string | undefined
	readonly terraformContext: WorkersTerraformContext
}

/**
 * Run the cloudflare-workers provision handlers in WORKERS_MANAGED_RESOURCES
 * order: the HCP workspace (Terraform's state backend) and the PlanetScale
 * database (a create-if-absent API step, not a Terraform resource) must both
 * exist before Terraform applies against them. Extracted from the target so the
 * class stays an orchestrator, not a handler bag.
 */
export function runWorkersProvision(
	input: WorkersProvisionInput,
): Promise<WorkersResourceOutcome> {
	return executeHandlers(WORKERS_MANAGED_RESOURCES, {
		'hcp-workspace': () =>
			ensureHcpWorkspace({
				organization: input.organization.terraformOrganization,
				workspaceName: input.workspaceName,
				token: input.hcpToken,
			}),
		'planetscale-database': () =>
			provisionPlanetscaleDatabase({
				organization: input.organization.planetscaleOrganization,
				config: input.config,
				projectName: input.projectName,
				environment: input.environment,
				serviceTokenId: input.planetscaleServiceTokenId,
				serviceToken: input.planetscaleServiceToken,
			}),
		terraform: () => applyWorkersTerraform(input.terraformContext),
	})
}
