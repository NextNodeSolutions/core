import type { ObjectStorageBinding } from '@/domain/storage/binding.ts'

import type { CaddyJsonConfig, CaddyUpstream } from './caddy-config.ts'
import { buildCaddyConfig, buildInternalCaddyConfig } from './caddy-config.ts'

export interface CaddyForProjectInput {
	readonly storage: ObjectStorageBinding
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly acmeEmail: string
	readonly internal: boolean
}

export function buildCaddyForProject(
	input: CaddyForProjectInput,
): CaddyJsonConfig {
	if (input.internal) {
		return buildInternalCaddyConfig({
			upstreams: input.upstreams,
			storage: input.storage,
			acmeEmail: input.acmeEmail,
		})
	}

	return buildCaddyConfig({
		upstreams: input.upstreams,
		acmeEmail: input.acmeEmail,
		storage: input.storage,
	})
}
