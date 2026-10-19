import { dirname, isAbsolute, resolve } from 'node:path'

import { CloudflareWorkersTarget } from '#/adapters/cloudflare/workers/target.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'

import { resolveOrganization } from './organization.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TargetDefinition } from './target.ts'
function resolveProjectDir(): string | undefined {
	const configFile = getEnv('PIPELINE_CONFIG_FILE')
	if (!configFile) return undefined
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	const absoluteConfig = isAbsolute(configFile)
		? configFile
		: resolve(workspace, configFile)
	return dirname(absoluteConfig)
}

function projectDirOption(
	projectDir: string | undefined,
): { projectDir: string } | undefined {
	if (!projectDir) return undefined
	return { projectDir }
}

type PlanetscaleCredentials = {
	planetscaleServiceTokenId: string
	planetscaleServiceToken: string
}
function planetscaleCredentials(
	config: CloudflareWorkersDeployableConfig,
): PlanetscaleCredentials | undefined {
	if (!config.services.planetscale) return undefined
	return {
		planetscaleServiceTokenId: requireEnv('PLANETSCALE_SERVICE_TOKEN_ID'),
		planetscaleServiceToken: requireEnv('PLANETSCALE_SERVICE_TOKEN'),
	}
}

function createCloudflareWorkersTarget(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): CloudflareWorkersTarget {
	requireEnv('CLOUDFLARE_API_TOKEN')
	return new CloudflareWorkersTarget({
		organization: resolveOrganization(config),
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		hcpToken: requireEnv('TF_TOKEN_app_terraform_io'),
		...planetscaleCredentials(config),
		...projectDirOption(resolveProjectDir()),
		environment,
		config,
	})
}

export const cloudflareWorkersTargetDefinition: TargetDefinition = {
	name: 'cloudflare-workers',
	build(config, ctx) {
		return createCloudflareWorkersTarget(config, ctx.environment)
	},
}
