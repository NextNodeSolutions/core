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

import { shellEscape } from './ssh/shell-escape.ts'

import type {
	DeployVolume,
	PostgresServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { CaddyUpstream } from '#/domain/caddy/config.ts'
import type {
	ContainerDeployedEnvironment,
	DeployEnv,
	ImageRef,
} from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

const REGISTRY_TOKEN_USER = '__token__'

// M1 deploys a single user workload named `app`: the image/host-port Records
// fed to the compose renderer are keyed by it, and its env file is `.env.app`.
// The Record source switches to the per-service IMAGE_REFS in M1.A-04.
const APP_SERVICE_NAME = 'app'

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
	// User workloads declared under [deploy.services.<name>]. The compose
	// renderer loops these; M1.A-04 switches the image/host-port Records over
	// to the per-service IMAGE_REFS source.
	readonly services: Record<string, UserServiceConfig>
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
 * Orchestrate a full container deploy: prepare files + login + pull +
 * bringUpDb, then bringUpApp. The staging matters because Path A schema
 * migrations run between the two phases at the pipeline level — postgres
 * must be healthy before migrate starts, and the app must rotate only
 * after migrate succeeds. When postgres is absent the staging collapses
 * cleanly: phase 1's bringUpDb is a no-op and phase 2 brings up `app`.
 *
 * Idempotent re-execution: when migrate-remote already ran phase 1 in a
 * prior GH Actions job, calling this from the deploy job re-writes the
 * same env+compose files (deterministic), re-pulls the same image (cache
 * hit), and re-asserts postgres health (already healthy → instant `--wait`
 * return). The only non-trivial work then is the `app` rotation.
 */
export async function deployContainer(
	session: SshSession,
	input: DeployContainerInput,
): Promise<DeployContainerResult> {
	await stageRollout(session, input)
	await bringUpApp(session, {
		projectName: input.projectName,
		environment: input.environment,
		postgres: input.postgres,
	})

	const silo = computeSilo(input.projectName, input.environment)
	logger.info(`Deployed ${silo.id} on port ${input.hostPort}`)

	return {
		upstream: {
			hostname: input.hostname,
			dial: `localhost:${input.hostPort}`,
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
 * Phase 1 in full: write the env + compose files, login to the registry
 * if needed, pull the app image, and bring postgres + postgres-backup up
 * to healthy. The migrate-remote CLI command calls this directly (then
 * runs migrate inside an ephemeral container joined to the same docker
 * network); the deploy CLI command reaches it via `deployContainer`.
 *
 * Writing the env file here (not later) matters: the migrate container
 * uses `--env-file` to pick up `DATABASE_URL` and any user secrets, so
 * the file must exist on disk BEFORE migrate runs — even if the app
 * itself hasn't rotated yet.
 */
export async function stageRollout(
	session: SshSession,
	input: DeployContainerInput,
): Promise<void> {
	const silo = computeSilo(input.projectName, input.environment)
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
	// Per-service env file (`.env.<name>`) is the isolation unit the compose
	// `env_file` points at. M1 has the single `app` workload, so we write
	// `.env.app`; the per-service fan-out lands with multi-service M2.
	await session.writeFile(
		`${envDir}/.env.${APP_SERVICE_NAME}`,
		formatComposeEnv(allEnv),
	)
	await session.writeFile(
		`${envDir}/compose.yaml`,
		renderComposeFile({
			services: input.services,
			images: { [APP_SERVICE_NAME]: input.image },
			hostPorts: { [APP_SERVICE_NAME]: input.hostPort },
			volumes: input.volumes,
			projectName: input.projectName,
			postgres: input.postgres,
			environment: input.environment,
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

	await bringUpDb(session, {
		projectName: input.projectName,
		environment: input.environment,
		postgres: input.postgres,
	})
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
 * Phase 2: rotate the user workloads. The embedded-postgres pair is brought
 * up in phase 1 (or is absent), and its compose `--wait` already gated it
 * healthy — a re-`up` of the whole file leaves the healthy DB untouched and
 * rotates every user service to its new image. So phase 2 is unconditionally
 * `up -d --remove-orphans` with no positional service (M1 has one user
 * workload; the bare form generalises to the multi-service file in M2/M3) and
 * drops any orphan left by a previous deploy.
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
		`docker compose -p ${siloIdQ} -f ${composeFileQ} up -d --remove-orphans`,
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
