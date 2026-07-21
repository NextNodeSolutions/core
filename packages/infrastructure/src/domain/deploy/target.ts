import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import type { AutoRestoreInput, AutoRestoreResult } from './auto-restore.ts'
import type {
	PagesResourceOutcome,
	VpsResourceOutcome,
	WorkersResourceOutcome,
} from './resource-outcome.ts'
import type { TeardownResult } from './teardown-result.ts'
import type { TeardownTarget } from './teardown-target.ts'

export interface ImageRef {
	readonly registry: string
	readonly repository: string
	readonly tag: string
}

/**
 * Public env surface handed to `target.deploy(env)` - already merged from
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
 * `mergeServiceEnvs` primitive - one source of truth, one collision
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
 * is missing - that means a DeployTarget skipped its `contributeEnv`
 * obligation, which is a wiring bug, not a runtime condition.
 */
export function buildDeployEnv(
	values: Readonly<Record<string, string>>,
): DeployEnv {
	const siteUrl = values['SITE_URL']
	if (!siteUrl) {
		throw new Error(
			'SITE_URL missing from merged env - every DeployTarget must put it in contributeEnv().public',
		)
	}
	return { ...values, SITE_URL: siteUrl }
}

export interface DeployInput {
	readonly secrets: Readonly<Record<string, string>>
	// Provenance for `secrets`: maps each BACKING-service secret key to the name
	// of the service that produced it (e.g. `DATABASE_URL` → `postgres`). User
	// secrets are absent. Lets the container target project backing secrets by
	// `needs` (least privilege) and build the shared `.env` the DB sidecar +
	// migrate read. An EMPTY map for targets with no backing services (Cloudflare
	// Pages ignores it) - provenance is always a map, never absent.
	readonly secretOrigins: Readonly<Record<string, string>>
	// Image ref per declared service, keyed by instance name - parsed from the
	// IMAGE_REFS env. Absent for static (Cloudflare Pages) targets, which build
	// no images.
	readonly images?: Readonly<Record<string, ImageRef>>
	readonly registryToken: string | undefined
}

interface BaseDeployedEnvironment {
	readonly name: string
	readonly url: string
	readonly deployedAt: Date
}

export interface ContainerDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'container'
	// Image deployed per declared service, keyed by instance name - one entry
	// per [deploy.services.<name>]. The deploy summary renders one row each.
	readonly imageRefs: Readonly<Record<string, ImageRef>>
}

export interface StaticDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'static'
}

/**
 * One deployed Worker within a cloudflare-workers deployment. `url` is the
 * Custom Domain a routed service answers on (`https://<resolved-host>`); an
 * internal worker (no declared `url`) carries an empty `url` - it is reachable
 * only through service bindings, so it has no public address to surface.
 */
export interface DeployedWorker {
	readonly name: string
	readonly url: string
}

export interface WorkerDeployedEnvironment extends BaseDeployedEnvironment {
	readonly kind: 'worker'
	// One entry per deployed [deploy.services.<name>] (routed + internal). The
	// deploy summary renders one row each, mirroring the container target's
	// per-service image rows.
	readonly workers: ReadonlyArray<DeployedWorker>
}

export type DeployedEnvironment =
	| ContainerDeployedEnvironment
	| StaticDeployedEnvironment
	| WorkerDeployedEnvironment

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

export interface WorkersProvisionResult {
	readonly kind: 'workers'
	readonly outcome: WorkersResourceOutcome
	readonly workspaceName: string
	readonly durationMs: number
}

export type ProvisionResult =
	| VpsProvisionResult
	| StaticProvisionResult
	| WorkersProvisionResult

export interface TargetState {
	readonly projectName: string
	readonly environments: ReadonlyArray<DeployedEnvironment>
}

export interface DeployResult {
	readonly projectName: string
	readonly deployedEnvironments: ReadonlyArray<DeployedEnvironment>
	readonly durationMs: number
}

/**
 * Inputs required to run schema migrations against the project's database
 * on the deploy target. The migrate runs in an ephemeral container built
 * from the same `image` as the app, joining the project's docker network
 * so the embedded postgres sidecar resolves at its compose service name.
 * `migrateCommand` is the shell command the container executes (default
 * `pnpm drizzle-kit migrate`, overridable via `[services.postgres].migrate_command`).
 */
export interface MigrateInput {
	readonly projectName: string
	readonly image: ImageRef
	readonly migrateCommand: string
	readonly environment: AppEnvironment
}

export interface MigrateResult {
	readonly durationMs: number
}

/**
 * Inputs for the on-demand pre-migrate snapshot. The orchestration knows
 * project + environment; the silo and compose-file path are derived inside
 * the adapter - the domain stays free of infra strings.
 */
export interface SnapshotInput {
	readonly projectName: string
	readonly environment: AppEnvironment
}

/**
 * Outcome of a pre-migrate snapshot triggered via the backup sidecar.
 * Just a wall-clock duration - the dump itself is identified by its
 * timestamp in R2, and `infrastructure restore --at <deploy-time>` picks
 * it via `selectPostgresBackupForRestore`. No need to track the key here.
 */
export interface SnapshotResult {
	readonly durationMs: number
}

/**
 * Default migrate command used when the project does not override
 * `[services.postgres].migrate_command`. Uses `drizzle-kit migrate` -
 * the platform-native runner that reads `drizzle.config.ts` (dialect +
 * `dbCredentials.url`, which the app's config reads from the injected
 * `DATABASE_URL` env). Zero app-side boilerplate for the dominant case;
 * non-Drizzle stacks override the field (e.g. `pnpm prisma migrate deploy`).
 */
export const DEFAULT_MIGRATE_COMMAND = 'pnpm drizzle-kit migrate'

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
	/**
	 * Phase 1 of a Path A rollout: prepare the env + compose files on the
	 * target, pull the image, and bring the database service up to
	 * healthy. Called by `migrate-remote` BEFORE `runMigrate` so the
	 * migrate container has both a reachable postgres (via the project's
	 * docker network) and an env file on disk (for `--env-file`). For
	 * static targets, throw "not applicable" - no DB to bring up.
	 */
	prepareRollout(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<void>
	/**
	 * Run database schema migrations against the target. For Hetzner VPS,
	 * spawns an ephemeral migrate container inside the project's docker
	 * network (postgres reachable at its compose service name, never
	 * exposed on the host). For static targets (Cloudflare Pages), this
	 * is a wiring bug - throw "not applicable" so the caller routes
	 * accordingly.
	 */
	runMigrate(input: MigrateInput): Promise<MigrateResult>
	/**
	 * Trigger an on-demand pre-migrate snapshot via the embedded
	 * `postgres-backup` sidecar. Called by `migrate-remote` AFTER the DB
	 * is healthy and BEFORE `runMigrate` runs, so a failed migration has
	 * a fresh dump to restore from. The sidecar uploads to R2 directly;
	 * we return the object key so deploy summaries surface it. For static
	 * targets, throw "not applicable" - no DB to snapshot.
	 */
	runPreMigrateSnapshot(input: SnapshotInput): Promise<SnapshotResult>
	/**
	 * Rehydrate a freshly-provisioned embedded database from the latest R2
	 * dump. Called by `migrate-remote` AFTER `prepareRollout` (DB up and
	 * healthy) and BEFORE the pre-migrate snapshot + `runMigrate`, so a
	 * replaced/disposable VPS recovers its data before forward-only
	 * migrations apply on top. Probes the live database first and restores
	 * ONLY when it is provably empty AND a prior dump exists
	 * (`planAutoRestore`); a populated database is never overwritten. For
	 * static targets (Cloudflare Pages), this is a wiring bug - throw "not
	 * applicable" so the caller routes accordingly.
	 */
	runAutoRestore(input: AutoRestoreInput): Promise<AutoRestoreResult>
	/**
	 * Capture a final on-demand backup of the embedded database to R2 BEFORE
	 * a teardown destroys it, so the next provisioning of this project (on a
	 * fresh VPS) auto-restores the very latest data instead of the last
	 * hourly dump. Mechanically identical to `runPreMigrateSnapshot` (the
	 * backup sidecar's `backup.sh`); the distinct method documents the intent
	 * and lets the teardown orchestrator treat a failure as "abort, do not
	 * destroy un-captured data". For static targets, throw "not applicable" -
	 * no DB to back up.
	 */
	runFinalBackup(input: SnapshotInput): Promise<SnapshotResult>
	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		shouldWipeVolumes: boolean,
	): Promise<TeardownResult>
	describe?(projectName: string): Promise<TargetState | null>
	/**
	 * Reconcile the target back to its declared state after an interrupted or
	 * partial operation. Optional: only targets whose source of truth can drift
	 * from reality implement it. The cloudflare-workers target implements it as a
	 * documented no-op - the Terraform state IS the source of truth, so there is
	 * nothing to reconcile.
	 */
	recover?(projectName: string): Promise<void>
	/**
	 * Load the env a target's backing infrastructure contributes when it is
	 * realised OUTSIDE the CLI `Service` registry - the cloudflare-workers
	 * target maps its Terraform outputs (D1/KV/Queue ids, R2 bucket names +
	 * CDN URLs, endpoint) into a `ServiceEnv` here, since its backing services
	 * are inert on the CLI side. Optional: targets whose backing env already
	 * flows through `resolveServices` (Hetzner, Pages) omit it. When present it
	 * merges through the same `mergeServiceEnvs` as target + services + secrets,
	 * so a key collision fails loud exactly like any other service's would.
	 */
	loadBackingEnv?(projectName: string): Promise<ServiceEnv>
}
