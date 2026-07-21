/**
 * Single source of truth for the infrastructure resources managed by the
 * Cloudflare Workers target's provision. `executeHandlers` derives its
 * exhaustiveness check from this tuple - adding a resource here breaks the
 * provision flow at compile-time until handled. Order is execution order:
 * the HCP workspace (Terraform's state backend) must exist before Terraform
 * runs against it.
 */
export const WORKERS_MANAGED_RESOURCES = ['hcp-workspace', 'terraform'] as const

export type WorkersManagedResource = (typeof WORKERS_MANAGED_RESOURCES)[number]

/**
 * Resources the Cloudflare Workers teardown tears down, in execution order:
 * `workers` deletes the deployed Worker scripts via wrangler FIRST (so no live
 * traffic hits resources Terraform is about to destroy), then `terraform`
 * destroys the backing infrastructure (D1/KV/Queues/R2 + Redirect Rules). The
 * HCP workspace is deliberately absent - it is preserved so the Terraform state
 * stays historised after a teardown.
 */
export const WORKERS_TEARDOWN_RESOURCES = ['workers', 'terraform'] as const

export type WorkersTeardownResource =
	(typeof WORKERS_TEARDOWN_RESOURCES)[number]
