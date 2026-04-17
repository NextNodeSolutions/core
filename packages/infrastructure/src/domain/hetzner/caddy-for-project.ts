import { computeR2Host } from '../cloudflare/r2/addressing.ts'
import type { R2RuntimeConfig } from '../cloudflare/r2/runtime-config.ts'

import type {
	CaddyJsonConfig,
	CaddyUpstream,
	R2StorageConfig,
} from './caddy-config.ts'
import { buildCaddyConfig, buildInternalCaddyConfig } from './caddy-config.ts'

export interface CaddyForProjectInput {
	readonly projectName: string
	readonly r2: R2RuntimeConfig
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly acmeEmail: string
	readonly internal: boolean
	readonly cloudflareApiToken: string
}

function buildR2Storage(
	r2: R2RuntimeConfig,
	projectName: string,
): R2StorageConfig {
	return {
		host: computeR2Host(r2.accountId),
		bucket: r2.certsBucket,
		accessId: r2.accessKeyId,
		secretKey: r2.secretAccessKey,
		prefix: `${projectName}/`,
	}
}

export function buildCaddyForProject(
	input: CaddyForProjectInput,
): CaddyJsonConfig {
	const r2Storage = buildR2Storage(input.r2, input.projectName)

	if (input.internal) {
		return buildInternalCaddyConfig({
			upstreams: input.upstreams,
			r2Storage,
			acmeEmail: input.acmeEmail,
			cloudflareApiToken: input.cloudflareApiToken,
		})
	}

	return buildCaddyConfig({
		upstreams: input.upstreams,
		acmeEmail: input.acmeEmail,
		r2Storage,
	})
}
