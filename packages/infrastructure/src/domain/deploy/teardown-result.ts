import type { WorkersTeardownResourceOutcome } from './resource-outcome.ts'
export type WorkersTeardownResult = {
	readonly kind: 'workers'
	readonly scope: 'project'
	readonly outcome: WorkersTeardownResourceOutcome
	readonly durationMs: number
}
export type TeardownResult = WorkersTeardownResult
