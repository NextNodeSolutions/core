import {
	buildCaddyConfig,
	buildDnsAcmeIssuer,
	buildPublicAcmeIssuer,
	buildUpstreamRoute,
} from './config.ts'

import type { ObjectStorageBinding } from '#/domain/storage/binding.ts'
import type { CaddyJsonConfig, CaddyUpstream } from './config.ts'

export interface CaddyComposeInput {
	readonly storage: ObjectStorageBinding
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly acmeEmail: string
	readonly internal: boolean
}

export function composeCaddyConfig(input: CaddyComposeInput): CaddyJsonConfig {
	const upstreamRoutes = input.upstreams.map(buildUpstreamRoute)

	const issuer = input.internal
		? buildDnsAcmeIssuer(input.acmeEmail)
		: buildPublicAcmeIssuer(input.acmeEmail)

	return buildCaddyConfig({
		routes: upstreamRoutes,
		subjects: input.upstreams.map(u => u.hostname),
		storage: input.storage,
		issuer,
	})
}
