import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar } from '@/adapters/github/env.ts'
import { writeSummary } from '@/adapters/github/output.ts'
import { getEnv, requireEnv } from '@/cli/env.ts'
import { loadR2Runtime } from '@/cli/r2/load-runtime.ts'
import { resolveServices } from '@/cli/services/resolve.ts'
import type { DeployableConfig } from '@/config/types.ts'
import { isHetznerDeployableConfig, requiresInfraR2 } from '@/config/types.ts'
import { buildDeploySummary } from '@/domain/deploy/deploy-summary.ts'
import { parseImageRef } from '@/domain/deploy/image-ref.ts'
import type { DeployInput } from '@/domain/deploy/target.ts'
import { resolveEnvironment } from '@/domain/environment.ts'
import { mergeServiceEnvs } from '@/domain/services/service.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { parseAllSecrets, pickSecrets } from './secrets.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')

	const infraR2 = requiresInfraR2(config)
		? await loadR2Runtime(cfToken)
		: null
	const target = buildRuntimeTarget(config, environment, infraR2)

	const baseEnv = await target.computeDeployEnv(config.project.name)
	const services = resolveServices({ config, environment, cfToken, infraR2 })
	const servicesEnv = mergeServiceEnvs(
		await Promise.all(services.map(service => service.loadEnv())),
	)
	const env = { ...baseEnv, ...servicesEnv.public }

	// GITHUB_ENV only carries the public surface (SITE_URL plus per-service
	// public bindings); credentials route through input.secrets so they
	// never land in the workflow env file.
	for (const [key, value] of Object.entries(env)) {
		writeEnvVar(key, value)
	}
	logger.info(`Wrote deploy env vars: ${Object.keys(env).join(', ')}`)

	const input = buildDeployInput(config, servicesEnv.secret)
	const result = await target.deploy(config.project.name, input, env)

	writeSummary(buildDeploySummary(result, target.name))
	logger.info(
		`Deploy complete for "${result.projectName}" in ${result.durationMs}ms`,
	)
}

function buildDeployInput(
	config: DeployableConfig,
	servicesSecrets: Readonly<Record<string, string>>,
): DeployInput {
	const secrets = {
		...loadSecrets(config.deploy.secrets),
		...servicesSecrets,
	}
	if (isHetznerDeployableConfig(config)) {
		return {
			secrets,
			image: parseImageRef(requireEnv('IMAGE_REF')),
			registryToken: requireEnv('GHCR_TOKEN'),
		}
	}
	return { secrets }
}

function loadSecrets(declared: ReadonlyArray<string>): Record<string, string> {
	if (declared.length === 0) return {}
	const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
	return pickSecrets(allSecrets, declared)
}
