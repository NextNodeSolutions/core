import type { DeployableConfig, DeployTargetType } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * `infraStorage` is nullable because Pages targets don't need it. Each
 * definition validates the precondition it actually needs — the runtime
 * guard lives once on the definition, not duplicated in every caller.
 */
export interface TargetFactoryContext {
	readonly environment: AppEnvironment
	readonly infraStorage: InfraStorageRuntimeConfig | null
}

/**
 * `build` accepts the full `DeployableConfig` union and narrows it
 * internally, returning `null` when the config doesn't match this
 * definition's discriminator. That keeps the registry shape uniform
 * across providers with different config types.
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
