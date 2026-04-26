import type { Service } from '@/cli/services/service.ts'
import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '@/domain/environment.ts'
import { buildR2ServiceEnv } from '@/domain/services/r2.ts'
import type { ServiceEnv } from '@/domain/services/service.ts'

import { ensureR2Service } from './ensure.ts'
import { loadR2Service } from './load.ts'

export interface R2ServiceFactoryInput {
	readonly cfToken: string
	readonly infraR2: R2RuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly bucketAliases: ReadonlyArray<string>
}

/**
 * Wrap the R2 ensure/load orchestrators behind the `Service` strategy so
 * `deploy.command` and `provision.command` only ever call generic
 * `service.provision()` / `service.loadEnv()` — they do not import any
 * R2-specific module.
 */
export function createR2Service(input: R2ServiceFactoryInput): Service {
	return {
		name: 'r2',
		async provision(): Promise<void> {
			await ensureR2Service({
				cfToken: input.cfToken,
				infraR2: input.infraR2,
				projectName: input.projectName,
				environment: input.environment,
				bucketAliases: input.bucketAliases,
			})
		},
		async loadEnv(): Promise<ServiceEnv> {
			const state = await loadR2Service({
				infraR2: input.infraR2,
				projectName: input.projectName,
				environment: input.environment,
			})
			return buildR2ServiceEnv(state)
		},
	}
}
