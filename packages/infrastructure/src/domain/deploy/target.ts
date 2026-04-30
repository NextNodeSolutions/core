import type { ServiceEnv } from '#/domain/services/service.ts'

import type {
	PagesResourceOutcome,
	VpsResourceOutcome,
} from './resource-outcome.ts'
import type { TeardownResult } from './teardown-result.ts'
import type { TeardownTarget } from './teardown-target.ts'

export interface ImageRef {
	readonly registry: string
	readonly repository: string
	readonly tag: string
}

/**
 * Public env surface handed to `target.deploy(env)` — already merged from
 * the target, every declared service, and the user-declared secrets'
 * public counterpart. SITE_URL is guaranteed by the orchestrator because
 * every target's `contributeEnv` puts it in `public`.
 */
export interface DeployEnv {
	readonly SITE_URL: string
	readonly [key: string]: string
}

/**
 * Env contribution from a deploy target. Same `{public, secret}` shape
 * as a `Service`, so targets and services merge through the same
 * `mergeServiceEnvs` primitive — one source of truth, one collision
 * detector. SITE_URL is required in `public` because every app needs it
 * at build + runtime and only the target knows the resolved hostname.
 */
export interface TargetEnv extends ServiceEnv {
	readonly public: Readonly<Record<string, string>> & {
		readonly SITE_URL: string
	}
}

/**
 * Narrow a merged public-env Record to a DeployEnv. Throws when SITE_URL
 * is missing — that means a DeployTarget skipped its `contributeEnv`
 * obligation, which is a wiring bug, not a runtime condition.
 */
export function buildDeployEnv(
	values: Readonly<Record<string, string>>,
): DeployEnv {
	const siteUrl = values['SITE_URL']
	if (!siteUrl) {
		throw new Error(
			'SITE_URL missing from merged env — every DeployTarget must put it in contributeEnv().public',
		)
	}
	return { ...values, SITE_URL: siteUrl }
}

export interface DeployInput {
	readonly secrets: Readonly<Record<string, string>>
	readonly image?: ImageRef
	readonly registryToken: string | undefined
}

interface BaseDeployedEnvironment {
	readonly name: string
	readonly url: string
	readonly deployedAt: Date
}

export interface ContainerDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'container'
	readonly imageRef: ImageRef
}

export interface StaticDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'static'
}

export type DeployedEnvironment =
	| ContainerDeployedEnvironment
	| StaticDeployedEnvironment

export interface VpsProvisionResult {
	readonly kind: 'vps'
	readonly outcome: VpsResourceOutcome
	readonly serverId: number
	readonly serverType: string
	readonly location: string
	readonly publicIp: string
	readonly tailnetIp: string
	readonly durationMs: number
}

export interface StaticProvisionResult {
	readonly kind: 'static'
	readonly outcome: PagesResourceOutcome
	readonly pagesProjectName: string
	readonly durationMs: number
}

export type ProvisionResult = VpsProvisionResult | StaticProvisionResult

export interface TargetState {
	readonly projectName: string
	readonly environments: ReadonlyArray<DeployedEnvironment>
}

export interface DeployResult {
	readonly projectName: string
	readonly deployedEnvironments: ReadonlyArray<DeployedEnvironment>
	readonly durationMs: number
}

export interface DeployTarget {
	readonly name: string
	/**
	 * Contribute the env this target owns (always SITE_URL, plus any
	 * target-specific keys). Returned as `TargetEnv | Promise<TargetEnv>`
	 * so sync impls (Hetzner, where SITE_URL is pure config arithmetic)
	 * don't pay async ceremony, while impls that need IO (Cloudflare
	 * looking up the live `*.pages.dev` subdomain) can return a Promise.
	 * The orchestrator merges this with services + user secrets via
	 * `mergeServiceEnvs`, then hands the public projection back to
	 * `deploy(env)`.
	 */
	contributeEnv(projectName: string): TargetEnv | Promise<TargetEnv>
	ensureInfra(projectName: string): Promise<ProvisionResult>
	reconcileDns(projectName: string, domain: string): Promise<void>
	deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult>
	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		withVolumes: boolean,
	): Promise<TeardownResult>
	describe?(projectName: string): Promise<TargetState | null>
}
