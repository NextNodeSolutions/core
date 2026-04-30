import type { DeployVolume } from '#/config/types.ts'
import type {
	ContainerDeployedEnvironment,
	DeployEnv,
	ImageRef,
} from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { CaddyUpstream } from '#/domain/hetzner/caddy-config.ts'
import { formatComposeEnv } from '#/domain/hetzner/compose-env.ts'
import {
	CONTAINER_PORT,
	renderComposeFile,
} from '#/domain/hetzner/compose-file.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'

const logger = createLogger()

const REGISTRY_TOKEN_USER = '__token__'

export interface DeployContainerInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly hostname: string
	readonly hostPort: number
	readonly env: DeployEnv
	readonly secrets: Readonly<Record<string, string>>
	readonly image: ImageRef
	readonly registryToken: string | undefined
	readonly volumes: ReadonlyArray<DeployVolume>
}

export interface DeployContainerResult {
	readonly upstream: CaddyUpstream
	readonly deployed: ContainerDeployedEnvironment
}

export async function deployContainer(
	session: SshSession,
	input: DeployContainerInput,
): Promise<DeployContainerResult> {
	const silo = computeSilo(input.projectName, input.environment)
	const hostPort = input.hostPort
	const envDir = `/opt/apps/${input.projectName}/${input.environment}`
	const envDirQ = shellEscape(envDir)
	const siloIdQ = shellEscape(silo.id)
	const composeFileQ = shellEscape(`${envDir}/compose.yaml`)

	const allEnv = {
		PORT: String(CONTAINER_PORT),
		...input.env,
		...input.secrets,
	}
	await session.exec(`mkdir -p ${envDirQ}`)
	await session.writeFile(`${envDir}/.env`, formatComposeEnv(allEnv))
	await session.writeFile(
		`${envDir}/compose.yaml`,
		renderComposeFile({
			image: input.image,
			hostPort,
			volumes: input.volumes,
		}),
	)

	if (input.registryToken !== undefined) {
		await loginToRegistry(
			session,
			input.image.registry,
			input.registryToken,
		)
	}

	await session.exec(`docker compose -p ${siloIdQ} -f ${composeFileQ} pull`)
	await session.exec(
		`docker compose -p ${siloIdQ} -f ${composeFileQ} up -d --remove-orphans`,
	)

	logger.info(`Deployed ${silo.id} on port ${hostPort}`)

	return {
		upstream: {
			hostname: input.hostname,
			dial: `localhost:${hostPort}`,
		},
		deployed: {
			kind: 'container',
			name: input.environment,
			imageRef: input.image,
			url: input.env.SITE_URL,
			deployedAt: new Date(),
		},
	}
}

async function loginToRegistry(
	session: SshSession,
	registry: string,
	token: string,
): Promise<void> {
	await session.execWithStdin(
		`docker login ${shellEscape(registry)} -u ${shellEscape(REGISTRY_TOKEN_USER)} --password-stdin`,
		token,
	)
	logger.info(`Authenticated to ${registry}`)
}
