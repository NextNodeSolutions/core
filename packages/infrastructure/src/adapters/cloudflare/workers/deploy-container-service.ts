import { wranglerDeploy } from '#/adapters/wrangler/deploy.ts'
import {
	buildContainerBackingSecrets,
	resolveContainerSecrets,
} from '#/domain/cloudflare/workers/container-secrets.ts'
import { buildContainerWranglerConfig } from '#/domain/cloudflare/workers/container-wrangler-config.ts'

import { resolveContainerGatewayEntry } from './container-gateway-entry.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ContainerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export interface ContainerServiceDeploy {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	readonly service: ContainerServiceConfig
	// The gateway's public env, built like a Worker's.
	readonly vars: Readonly<Record<string, string>>
	readonly outputs: WorkersTerraformOutputs
	// The repository's Infisical secrets; undefined without a project.
	readonly projectSecrets: Readonly<Record<string, string>> | undefined
	// The pushed reference of the service's image, and the release the
	// gateway answers the health check with.
	readonly image: string
	readonly release: string
	readonly wranglerRunner: WranglerRunner
	readonly projectDir: string
}

/**
 * Deploy one container service: the gateway Worker with the container
 * application pointing at the pushed image, holding exactly the Infisical
 * secrets plus the backing secrets. Wrangler returns before the rollout ends;
 * the gateway restarts a container still on the previous image at the first
 * request, and the smoke check absorbs that boot.
 */
export async function deployContainerService(
	job: ContainerServiceDeploy,
): Promise<void> {
	const secrets = resolveContainerSecrets(
		job.projectSecrets,
		buildContainerBackingSecrets(job.service, job.outputs),
	)
	const document = buildContainerWranglerConfig({
		projectName: job.projectName,
		environment: job.environment,
		serviceName: job.serviceName,
		service: job.service,
		vars: job.vars,
		gatewayEntry: resolveContainerGatewayEntry(),
		image: job.image,
		release: job.release,
	})
	await wranglerDeploy({
		document,
		runner: job.wranglerRunner,
		cwd: job.projectDir,
		...(secrets && { secrets }),
	})
}
