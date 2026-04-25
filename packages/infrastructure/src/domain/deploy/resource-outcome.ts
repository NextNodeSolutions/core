import type { PagesManagedResource } from '@/domain/cloudflare/managed-resources.ts'
import type {
	VpsManagedResource,
	VpsProjectManagedResource,
} from '@/domain/hetzner/managed-resources.ts'

export interface ResourceOutcome {
	readonly handled: boolean
	readonly detail: string
}

/**
 * Mapped from VPS_MANAGED_RESOURCES - adding a resource to the tuple
 * breaks both provision and teardown until both handle it.
 */
export type VpsResourceOutcome = Readonly<
	Record<VpsManagedResource, ResourceOutcome>
>

export type VpsProjectResourceOutcome = Readonly<
	Record<VpsProjectManagedResource, ResourceOutcome>
>

export type PagesResourceOutcome = Readonly<
	Record<PagesManagedResource, ResourceOutcome>
>
