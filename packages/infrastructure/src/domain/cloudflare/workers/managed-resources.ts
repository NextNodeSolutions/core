/**
 * Single source of truth for the infrastructure resources managed by the
 * Cloudflare Workers target's provision. `executeHandlers` derives its
 * exhaustiveness check from this tuple - adding a resource here breaks the
 * provision flow at compile-time until handled. Order is execution order:
 * the HCP workspace (Terraform's state backend) must exist before Terraform
 * runs against it, and the PlanetScale database must exist (and be ready)
 * before Terraform creates the branch-role + Hyperdrive config wired to it -
 * the PlanetScale provider has no database resource, so the DB is a create-if-
 * absent API step, not a Terraform-managed resource.
 */
export const WORKERS_MANAGED_RESOURCES = [
	'hcp-workspace',
	'planetscale-database',
	'terraform',
] as const

export type WorkersManagedResource = (typeof WORKERS_MANAGED_RESOURCES)[number]

/**
 * Resources the Cloudflare Workers teardown tears down, in execution order:
 * `workers` deletes the deployed Worker scripts via wrangler FIRST (so no live
 * traffic hits resources Terraform is about to destroy), then `terraform`
 * destroys the backing infrastructure (D1/KV/Queues/R2 + Redirect Rules, plus
 * the PlanetScale branch-role + Hyperdrive config). The HCP workspace is
 * deliberately absent - it is preserved so the Terraform state stays historised.
 * The PlanetScale DATABASE is likewise preserved: it is created out-of-band (not
 * a Terraform resource), so `terraform destroy` removes only the role + Hyperdrive
 * config wired to it - the database and its data survive and are deleted manually,
 * the same safe-by-default stance as the historised HCP state.
 */
export const WORKERS_TEARDOWN_RESOURCES = ['workers', 'terraform'] as const

export type WorkersTeardownResource =
	(typeof WORKERS_TEARDOWN_RESOURCES)[number]
