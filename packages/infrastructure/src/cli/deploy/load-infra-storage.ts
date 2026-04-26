import { requireEnv } from '@/cli/env.ts'
import { ensureR2Setup } from '@/cli/r2/ensure-setup.ts'
import { loadR2Runtime } from '@/cli/r2/load-runtime.ts'
import type { DeployableConfig } from '@/config/types.ts'
import { requiresInfraStorage } from '@/config/types.ts'
import type { InfraStorageRuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

/**
 * Single entry point for deploy/dns/teardown to resolve the infra
 * storage runtime config (state + certs buckets). Returns `null` when
 * the config doesn't need it (Cloudflare Pages with no R2 service);
 * otherwise loads it via `loadR2Runtime`. Centralized so the predicate
 * never drifts across commands — getting it wrong silently skips state
 * reads at deploy/teardown.
 */
export async function loadInfraStorageForConfig(
	config: DeployableConfig,
): Promise<InfraStorageRuntimeConfig | null> {
	if (!requiresInfraStorage(config)) return null
	return loadR2Runtime(requireEnv('CLOUDFLARE_API_TOKEN'))
}

/**
 * Provision-time pendant of `loadInfraStorageForConfig`: bootstraps the
 * infra storage buckets, the org-wide R2 token, and the GitHub org
 * secrets. Used by `provision.command` only.
 */
export async function ensureInfraStorageForConfig(
	config: DeployableConfig,
	cfToken: string,
): Promise<InfraStorageRuntimeConfig | null> {
	if (!requiresInfraStorage(config)) return null
	return ensureR2Setup(cfToken)
}
