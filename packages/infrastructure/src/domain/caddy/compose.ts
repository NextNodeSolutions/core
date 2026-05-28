import {
	buildCaddyConfig,
	buildDnsAcmeIssuer,
	buildPublicAcmeIssuer,
	buildUpstreamRoute,
} from './config.ts'
import { buildSupabaseRoutes, buildSupabaseSubjects } from './supabase.ts'

import type { ObjectStorageBinding } from '#/domain/storage/binding.ts'
import type { CaddyJsonConfig, CaddyUpstream } from './config.ts'
import type { SupabaseCaddyBinding } from './supabase.ts'

export interface CaddyComposeInput {
	readonly storage: ObjectStorageBinding
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly acmeEmail: string
	readonly internal: boolean
	readonly supabase?: SupabaseCaddyBinding
}

export function composeCaddyConfig(input: CaddyComposeInput): CaddyJsonConfig {
	const upstreamRoutes = input.upstreams.map(buildUpstreamRoute)
	const supabaseRoutes = input.supabase
		? buildSupabaseRoutes(input.supabase.deployDomain)
		: []
	const supabaseSubjects = input.supabase
		? buildSupabaseSubjects(input.supabase.deployDomain)
		: []

	const issuer = input.internal
		? buildDnsAcmeIssuer(input.acmeEmail)
		: buildPublicAcmeIssuer(input.acmeEmail)

	return buildCaddyConfig({
		routes: [...upstreamRoutes, ...supabaseRoutes],
		subjects: [
			...input.upstreams.map(u => u.hostname),
			...supabaseSubjects,
		],
		storage: input.storage,
		issuer,
	})
}
