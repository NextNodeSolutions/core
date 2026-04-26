import type { DeployableConfig, DeployTargetType } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Shared context every target definition receives. Hetzner targets
 * require a non-null `infraStorage`; Pages targets do not. Each definition
 * validates the preconditions it actually needs — the runtime guard
 * lives once in the definition, not duplicated in callers.
 */
export interface TargetFactoryContext {
	readonly environment: AppEnvironment
	readonly infraStorage: InfraStorageRuntimeConfig | null
}

/**
 * Registry-friendly deploy-target definition: a uniform `build` over the
 * full DeployableConfig, returning a `DeployTarget` when this definition
 * matches the config's `deploy.target` discriminator and `null`
 * otherwise. Each definition narrows the union internally — that keeps
 * the registry shape uniform across providers with different config
 * types.
 */
export interface TargetDefinition<
	K extends DeployTargetType = DeployTargetType,
> {
	readonly name: K
	build(
		config: DeployableConfig,
		ctx: TargetFactoryContext,
	): DeployTarget | null
}
