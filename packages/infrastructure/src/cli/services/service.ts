import type { GithubRepository } from '#/cli/env.ts'
import type { ServiceName, ServicesConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

/**
 * Strategy contract for a per-project service (R2, D1, KV, queues, …).
 * Two operations frame the lifecycle:
 *   - `provision()` runs from `provision.command`, is idempotent, and
 *     persists the resulting state durably (typically the infra storage
 *     state bucket).
 *   - `loadEnv()` runs from `deploy.command`, reads that state back, and
 *     projects the env vars + credentials the runtime needs.
 */
export interface Service {
	readonly name: ServiceName
	provision(): Promise<void>
	loadEnv(): Promise<ServiceEnv>
}

/**
 * `infraStorage` is nullable because not every service needs it; each
 * factory validates the preconditions it actually requires. It carries
 * the R2 credentials usable by services that provision their own infra
 * - `accessKeyId` / `secretAccessKey` / `endpoint` to instantiate an
 * S3 client against R2, and `accountId` to call the Cloudflare R2 REST
 * API (e.g. `ensureR2Bucket`). The R2 service uses both shapes; the
 * postgres service uses `accountId` + `cfToken` at provision time to
 * ensure its two backup buckets (`<project>-backups` wal-g +
 * `<project>-backups-dump` pg_dump).
 *
 * `repoSecrets` is the parsed `ALL_SECRETS` GitHub Secrets payload -
 * services that need user-provided credentials (e.g. postgres
 * `DATABASE_URL` / `POSTGRES_PASSWORD`) read from here. Always defined
 * (`{}` when the env var is absent) so factories never need to
 * null-check.
 */
export interface ServiceFactoryContext {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly repository: GithubRepository
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
	readonly repoSecrets: Readonly<Record<string, string>>
	/**
	 * Project deploy domain already resolved against the current
	 * environment via `resolveDeployDomain` (so callers see `example.com`
	 * in production, `dev.example.com` in development). `null` when the
	 * project does not declare `project.domain` - services that require
	 * a domain must fail loud rather than fall back silently.
	 */
	readonly deployDomain: string | null
}

export interface ServiceDefinition<K extends ServiceName = ServiceName> {
	readonly name: K
	build(services: ServicesConfig, ctx: ServiceFactoryContext): Service | null
}
