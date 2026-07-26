import { resolve } from 'node:path'

import { writeWorkerTypes } from '#/adapters/cloudflare/workers/write-worker-types.ts'
import { loadConfig } from '#/config/load.ts'
import {
	isCloudflareWorkersDeployableConfig,
	isDeployableConfig,
} from '#/config/types.ts'
import { renderDevVarsExample } from '#/domain/cloudflare/workers/dev-vars-example.ts'
import { buildWorkerEnvDocument } from '#/domain/cloudflare/workers/worker-env-document.ts'
import { renderWorkerEnvTypes } from '#/domain/cloudflare/workers/worker-env-types.ts'

import type { DeployableConfig } from '#/config/types.ts'

export function generateWorkerTypes(
	config: DeployableConfig,
	configDir: string,
): ReadonlyArray<string> {
	if (!isCloudflareWorkersDeployableConfig(config)) return []

	const workerServices = config.deploy.services
	return Object.entries(workerServices).flatMap(([serviceName, service]) => {
		// One document per worker feeds both generated files, so they can never
		// describe two different workers.
		const document = buildWorkerEnvDocument({
			serviceName,
			service,
			services: config.services,
			workerServices,
			secretNames: service.secrets,
		})
		return writeWorkerTypes({
			entryPath: resolve(configDir, service.entry),
			types: renderWorkerEnvTypes(document, service.secrets),
			devVarsExample: renderDevVarsExample(document, service.secrets),
		})
	})
}

export function generateWorkerTypesFromFile(
	configPath: string,
): ReadonlyArray<string> {
	const absolute = resolve(configPath)
	const config = loadConfig(absolute)
	if (!isDeployableConfig(config)) return []
	return generateWorkerTypes(config, resolve(absolute, '..'))
}
