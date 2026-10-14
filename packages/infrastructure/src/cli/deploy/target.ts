import type { DeployableConfig, DeployTargetType } from '#/config/types.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export type TargetFactoryContext = { readonly environment: AppEnvironment }
export type TargetDefinition<K extends DeployTargetType = DeployTargetType> = {
	readonly name: K
	build(config: DeployableConfig, context: TargetFactoryContext): DeployTarget
}
