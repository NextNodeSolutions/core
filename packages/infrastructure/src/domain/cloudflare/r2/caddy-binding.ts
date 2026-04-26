import type { ObjectStorageBinding } from '@/domain/storage/binding.ts'

import { computeR2Host } from './addressing.ts'
import type { InfraStorageRuntimeConfig } from './runtime-config.ts'

/**
 * Project the infra storage runtime + a project name into the generic
 * `ObjectStorageBinding` Caddy expects for cert storage. R2-specific
 * addressing (account-scoped host) lives here, not in the Hetzner
 * domain that consumes the binding.
 */
export function buildR2CaddyBinding(
	infraStorage: InfraStorageRuntimeConfig,
	projectName: string,
): ObjectStorageBinding {
	return {
		host: computeR2Host(infraStorage.accountId),
		bucket: infraStorage.certsBucket,
		accessKeyId: infraStorage.accessKeyId,
		prefix: `${projectName}/`,
	}
}
