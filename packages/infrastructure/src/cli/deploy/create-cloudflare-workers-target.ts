import { CloudflareWorkersTarget } from '#/adapters/cloudflare/workers/target.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'

import { resolveConfigDir } from './config-dir.ts'
import { resolveOrganization } from './organization.ts'

import type { ContainerImageSource } from '#/adapters/cloudflare/workers/deploy-container-service.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TargetDefinition } from './target.ts'

function projectDirOption(
	projectDir: string | undefined,
): { projectDir: string } | undefined {
	if (!projectDir) return undefined
	return { projectDir }
}

// The deploy job sets both after downloading the `containers` job's artifact;
// every other job sets neither.
function containerImagesOption():
	| { containerImages: ContainerImageSource }
	| undefined {
	if (!getEnv('CONTAINER_IMAGES_DIR') && !getEnv('IMAGE_TAG'))
		return undefined
	return {
		containerImages: {
			archiveDir: requireEnv('CONTAINER_IMAGES_DIR'),
			imageTag: requireEnv('IMAGE_TAG'),
		},
	}
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

export function createCloudflareWorkersTarget(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): CloudflareWorkersTarget {
	return new CloudflareWorkersTarget({
		organization: resolveOrganization(config),
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		cloudflareApiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
		hcpToken: requireEnv('TF_TOKEN_app_terraform_io'),
		...planetscaleCredentials(config),
		...projectDirOption(resolveConfigDir()),
		...containerImagesOption(),
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
