/**
 * Single source of truth for all infrastructure resources managed by
 * the Cloudflare Pages target. Both provision and teardown derive their
 * exhaustiveness checks from this tuple - adding a resource here
 * breaks both flows at compile-time until handled.
 */
export const PAGES_MANAGED_RESOURCES = ['pages-project', 'dns'] as const

export type PagesManagedResource = (typeof PAGES_MANAGED_RESOURCES)[number]
