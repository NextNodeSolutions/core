import type {
	WorkersManagedResource,
	WorkersTeardownResource,
} from '#/domain/cloudflare/workers/managed-resources.ts'

export type ResourceOutcome = {
	readonly handled: boolean
	readonly detail: string
}
export type WorkersResourceOutcome = Readonly<
	Record<WorkersManagedResource, ResourceOutcome>
>
export type WorkersTeardownResourceOutcome = Readonly<
	Record<WorkersTeardownResource, ResourceOutcome>
>
