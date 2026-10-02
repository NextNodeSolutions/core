import type { ServicesConfig } from '#/config/service-config.ts'
import type { CronJobConfig } from '#/config/types.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersTerraformOutputs } from './outputs-env.ts'

// Everything `buildWranglerConfig` reads to generate one service's wrangler
// configuration document. Owned separately from the builder so the extracted
// builders (backing-bindings.ts) can type their input without a cycle back to
// wrangler-config.ts.
export interface WranglerConfigInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	readonly service: WorkerServiceConfig
	// The whole [services.*] block: which backing resources exist (D1/KV/R2/
	// Queues) is read from here, then filtered by the service's own `needs`.
	readonly services: ServicesConfig
	// The provision outputs (ids Terraform emitted). Read straight through - this
	// stays a re-parse-free consumer of `WorkersTerraformOutputs`.
	readonly outputs: WorkersTerraformOutputs
	readonly cron: ReadonlyArray<CronJobConfig>
	// Declaration order of every service, so cron's "primary = first service"
	// default resolves identically to the schema's own rule.
	readonly serviceNames: ReadonlyArray<string>
	// Public runtime vars. Empty for now; US-3.2 fills SITE_URL + peer URLs +
	// backing env. Emitted only when non-empty.
	readonly vars: Readonly<Record<string, string>>
}
