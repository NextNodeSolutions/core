import { computeR2Host } from '../cloudflare/r2/addressing.ts'
import type { R2RuntimeConfig } from '../cloudflare/r2/runtime-config.ts'

import type { CaddyJsonConfig, CaddyUpstream } from './caddy-config.ts'
import { buildCaddyConfig } from './caddy-config.ts'

export interface CaddyForProjectInput {
	readonly projectName: string
	readonly r2: R2RuntimeConfig
	readonly upstreams: ReadonlyArray<CaddyUpstream>
}

export function buildCaddyForProject(
	input: CaddyForProjectInput,
): CaddyJsonConfig {
	return buildCaddyConfig({
		upstreams: input.upstreams,
		r2Storage: {
			host: computeR2Host(input.r2.accountId),
			bucket: input.r2.certsBucket,
			accessId: input.r2.accessKeyId,
			secretKey: input.r2.secretAccessKey,
			prefix: `${input.projectName}/`,
		},
	})
}
