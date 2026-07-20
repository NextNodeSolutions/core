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
