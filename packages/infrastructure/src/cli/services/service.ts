import type { ServiceName, ServicesConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv, ServiceMode } from '#/domain/services/service.ts'

/**
 * Strategy contract for a per-project service (R2, D1, KV, queues, …).
 *
 * Two operations frame the lifecycle:
 *   - `provision()` runs from `provision.command` and is idempotent. It
 *     creates buckets/databases/tokens and persists the resulting state
 *     somewhere durable (typically the infra storage state bucket).
 *   - `loadEnv()` runs from `deploy.command` and reads that state back
 *     to project the env vars + credentials the runtime needs.
 *
 * Adding a new service = a new `ServiceDefinition` registered in
 * `cli/services/registry.ts`; `deploy.command` and `provision.command`
 * stay untouched.
 */
export interface Service {
	readonly name: string
	provision(): Promise<void>
	loadEnv(): Promise<ServiceEnv>
}

/**
 * Shared context every service factory receives. Carries project
 * identity, the resolved environment, the bootstrap Cloudflare token,
 * the infra storage runtime (when initialized), and the fulfillment mode.
 * Each factory validates the preconditions it actually needs.
 */
export interface ServiceFactoryContext {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
	// TODO(nn-local): this is the switch the future `nn` CLI flips from
	// 'remote' to 'local' so each ServiceDefinition.build returns its
	// docker-compose variant.
	readonly mode: ServiceMode
}

/**
 * Registry-friendly service definition: a uniform `build` over the full
 * `services` config, returning a `Service` when the project opted into
 * this service and `null` otherwise. Each definition narrows its own
 * config slot internally — that keeps the registry shape uniform across
 * services with different config types.
 */
export interface ServiceDefinition<K extends ServiceName = ServiceName> {
	readonly name: K
	build(services: ServicesConfig, ctx: ServiceFactoryContext): Service | null
}
