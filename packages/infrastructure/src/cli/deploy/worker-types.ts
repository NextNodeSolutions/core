import { resolve } from 'node:path'

import { writeWorkerTypes } from '#/adapters/cloudflare/workers/write-worker-types.ts'
import { loadConfig } from '#/config/load.ts'
import {
	isCloudflareWorkersDeployableConfig,
	isDeployableConfig,
} from '#/config/types.ts'
import { renderWorkerEnvTypes } from '#/domain/cloudflare/workers/worker-env-types.ts'

import type { DeployableConfig } from '#/config/types.ts'

export function generateWorkerTypes(
	config: DeployableConfig,
	configDir: string,
): ReadonlyArray<string> {
	if (!isCloudflareWorkersDeployableConfig(config)) return []

	const serviceNames = Object.keys(config.deploy.services)
	return Object.entries(config.deploy.services).flatMap(
		([serviceName, service]) => {
			// A static-assets-only Worker (entry = false) has no script and no
			// script env - there is no `Env` interface to render types for.
			if (service.entry === false) return []
			return [
				writeWorkerTypes({
					entryPath: resolve(configDir, service.entry),
					content: renderWorkerEnvTypes({
						serviceName,
						service,
						services: config.services,
						serviceNames,
						secretNames: service.secrets,
					}),
				}),
			]
		},
	)
}

export function generateWorkerTypesFromFile(
	configPath: string,
): ReadonlyArray<string> {
	const absolute = resolve(configPath)
	const config = loadConfig(absolute)
	if (!isDeployableConfig(config)) return []
	return generateWorkerTypes(config, resolve(absolute, '..'))
}
