import type {
	PagesResourceOutcome,
	VpsProjectResourceOutcome,
	VpsResourceOutcome,
} from './resource-outcome.ts'

export interface VpsFullTeardownResult {
	readonly kind: 'vps'
	readonly scope: 'vps'
	readonly outcome: VpsResourceOutcome
	readonly durationMs: number
}

export interface VpsProjectTeardownResult {
	readonly kind: 'vps'
	readonly scope: 'project'
	readonly outcome: VpsProjectResourceOutcome
	readonly durationMs: number
}

export type VpsTeardownResult = VpsFullTeardownResult | VpsProjectTeardownResult

export interface StaticTeardownResult {
	readonly kind: 'static'
	readonly scope: 'project'
	readonly pagesProjectName: string
	readonly outcome: PagesResourceOutcome
	readonly durationMs: number
}

export type TeardownResult = VpsTeardownResult | StaticTeardownResult
