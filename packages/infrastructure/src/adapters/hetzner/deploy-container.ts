import type { DeployVolume, PostgresServiceConfig } from '#/config/types.ts'
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
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_SIDECAR_SERVICE_NAME,
} from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'

const logger = createLogger()

const REGISTRY_TOKEN_USER = '__token__'

/**
 * Seconds the docker compose CLI's native `--wait` flag will block before
 * giving up on a service reporting `healthy`. 60s comfortably covers a
 * cold `postgres:18` `initdb` on a `cpx22` (typically 5–15s) and aborts
 * the deploy loudly when the container is wedged.
 */
const POSTGRES_WAIT_TIMEOUT_SECONDS = 60

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
	readonly postgres: PostgresServiceConfig | undefined
}

export interface DeployContainerResult {
	readonly upstream: CaddyUpstream
	readonly deployed: ContainerDeployedEnvironment
}

/**
 * Inputs needed by the staged bring-up helpers. The two phases derive
 * everything they need (silo, compose file path) from `projectName` +
 * `environment`, and key off `postgres` to decide whether to bring the
 * DB up first or fall through to a single combined bring-up.
 */
export interface BringUpInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly postgres: PostgresServiceConfig | undefined
}

/**
 * Orchestrate a full container deploy: prepare files + login + pull, then
 * stage the bring-up as `bringUpDb` → `bringUpApp`. The staging matters
 * because Path A schema migrations run between the two phases at the
 * pipeline level — postgres must be healthy before migrate starts, and
 * the app must rotate only after migrate succeeds. When postgres is
 * absent the staging collapses cleanly: phase 1 is a no-op and phase 2
 * brings up `app` via the original full `up -d --remove-orphans`.
 */
export async function deployContainer(
	session: SshSession,
	input: DeployContainerInput,
): Promise<DeployContainerResult> {
	const silo = computeSilo(input.projectName, input.environment)
	const hostPort = input.hostPort
	const envDir = `/opt/apps/${input.projectName}/${input.environment}`
	const envDirQ = shellEscape(envDir)
	const composeFileQ = shellEscape(`${envDir}/compose.yaml`)
	const siloIdQ = shellEscape(silo.id)

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
			projectName: input.projectName,
			postgres: input.postgres,
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

	const bringUp: BringUpInput = {
		projectName: input.projectName,
		environment: input.environment,
		postgres: input.postgres,
	}
	await bringUpDb(session, bringUp)
	await bringUpApp(session, bringUp)

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

/**
 * Phase 1: bring postgres + postgres-backup up and block until postgres
 * reports healthy via the compose healthcheck. We use Docker Compose's
 * native `--wait` flag — the CLI subscribes to daemon health events
 * directly, so there is no polling loop in this codebase and no JSON
 * status parsing. `--wait-timeout` caps the blocking duration; the CLI
 * exits non-zero (which `session.exec` propagates as a thrown error) on
 * timeout or unhealthy state. No-op when the project does not declare a
 * postgres service — phase 2 then performs a single combined bring-up.
 */
export async function bringUpDb(
	session: SshSession,
	input: BringUpInput,
): Promise<void> {
	if (!input.postgres) return

	const silo = computeSilo(input.projectName, input.environment)
	const composeFile = `/opt/apps/${input.projectName}/${input.environment}/compose.yaml`
	const siloIdQ = shellEscape(silo.id)
	const composeFileQ = shellEscape(composeFile)

	await session.exec(
		`docker compose -p ${siloIdQ} -f ${composeFileQ} up -d --wait --wait-timeout ${String(POSTGRES_WAIT_TIMEOUT_SECONDS)} ${POSTGRES_SIDECAR_SERVICE_NAME} ${POSTGRES_BACKUP_SERVICE_NAME}`,
	)
}

/**
 * Phase 2: rotate the app container. `renderComposeFile` only ever emits
 * three services — `app`, `postgres`, `postgres-backup` — and the DB
 * pair is brought up in phase 1 (or absent altogether). So phase 2 is
 * unconditionally `up -d --remove-orphans app`: it rotates the single
 * non-DB service and drops any orphan left by a previous deploy.
 */
export async function bringUpApp(
	session: SshSession,
	input: BringUpInput,
): Promise<void> {
	const silo = computeSilo(input.projectName, input.environment)
	const composeFile = `/opt/apps/${input.projectName}/${input.environment}/compose.yaml`
	const siloIdQ = shellEscape(silo.id)
	const composeFileQ = shellEscape(composeFile)

	await session.exec(
		`docker compose -p ${siloIdQ} -f ${composeFileQ} up -d --remove-orphans app`,
	)
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
