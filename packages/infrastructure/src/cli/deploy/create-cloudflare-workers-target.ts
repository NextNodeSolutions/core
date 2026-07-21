import { dirname, isAbsolute, resolve } from 'node:path'

import { CloudflareWorkersTarget } from '#/adapters/cloudflare/workers/target.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TargetDefinition } from './target.ts'

// The project package dir `wrangler deploy` runs from - the dir holding the
// app's nextnode.toml (and its built bundle). Mirrors plan's package-dir
// mechanism (PIPELINE_CONFIG_FILE, resolved against GITHUB_WORKSPACE) but as an
// ABSOLUTE path, since the CLI runs from .infra/packages/infrastructure while
// the bundle lives in the caller workspace. Only `deploy` consumes it, so it is
// resolved leniently (undefined when PIPELINE_CONFIG_FILE is absent); `deploy`
// fails loud if it is genuinely missing, while provision/teardown never need it.
function resolveProjectDir(): string | undefined {
	const configFile = getEnv('PIPELINE_CONFIG_FILE')
	if (configFile === undefined || configFile === '') return undefined
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const absoluteConfig = isAbsolute(configFile)
		? configFile
		: resolve(workspace, configFile)
	return dirname(absoluteConfig)
}

export function createCloudflareWorkersTarget(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): CloudflareWorkersTarget {
	// The Terraform Cloudflare provider authenticates from the ambient
	// CLOUDFLARE_API_TOKEN (defaultTerraformRunner forwards process.env); require
	// it here so a missing token fails fast at factory time, not mid-apply.
	requireEnv('CLOUDFLARE_API_TOKEN')
	const projectDir = resolveProjectDir()
	return new CloudflareWorkersTarget({
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		hcpToken: requireEnv('TF_TOKEN_app_terraform_io'),
		...(projectDir === undefined ? {} : { projectDir }),
		environment,
		config,
	})
}

export const cloudflareWorkersTargetDefinition: TargetDefinition<'cloudflare-workers'> =
	{
		name: 'cloudflare-workers',
		build(config, ctx) {
			if (!isCloudflareWorkersDeployableConfig(config)) return null
			return createCloudflareWorkersTarget(config, ctx.environment)
		},
	}
