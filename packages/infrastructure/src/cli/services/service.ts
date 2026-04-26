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
 * factory validates the preconditions it actually requires.
 */
export interface ServiceFactoryContext {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
}

export interface ServiceDefinition<K extends ServiceName = ServiceName> {
	readonly name: K
	build(services: ServicesConfig, ctx: ServiceFactoryContext): Service | null
}
