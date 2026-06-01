import {
	resolveSoleService,
	selectServiceImage,
} from '#/domain/deploy/image-ref.ts'
import { formatComposeEnv } from '#/domain/hetzner/compose-env.ts'
import { renderComposeFile } from '#/domain/hetzner/compose-file.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import { buildServiceUrlEnv } from '#/domain/hetzner/service-env.ts'
import { buildServiceUpstreams } from '#/domain/hetzner/service-upstreams.ts'
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
	// Allocated host port per url service, keyed by instance name. Internal-only
	// services (no url) hold no entry — they publish no host port.
	readonly hostPorts: Readonly<Record<string, number>>
	readonly env: DeployEnv
	readonly secrets: Readonly<Record<string, string>>
	// Image ref per declared service, keyed by instance name — sourced from the
	// IMAGE_REFS env and passed straight to the compose renderer.
	readonly images: Readonly<Record<string, ImageRef>>
	readonly registryToken: string | undefined
	readonly volumes: ReadonlyArray<DeployVolume>
	readonly postgres: PostgresServiceConfig | undefined
	// User workloads declared under [deploy.services.<name>]. The compose
	// renderer loops these, pairing each with its ref from `images`.
	readonly services: Readonly<Record<string, UserServiceConfig>>
}

export interface DeployContainerResult {
	// One Caddy upstream per service that declares a url; internal-only services
	// (no url) contribute none. Empty when the project routes nothing externally.
	readonly upstreams: ReadonlyArray<CaddyUpstream>
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

	const { name } = resolveSoleService(input.services)
	const silo = computeSilo(input.projectName, input.environment)
	const upstreams = buildServiceUpstreams(input.services, input.hostPorts)
	logger.info(
		`Deployed ${silo.id} with ${String(upstreams.length)} routed service(s)`,
	)

	return {
		upstreams,
		deployed: {
			kind: 'container',
			name: input.environment,
			imageRef: selectServiceImage(input.images, name),
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

	await session.exec(`mkdir -p ${envDirQ}`)
	await writeServiceEnvFiles(session, envDir, input)
	await session.writeFile(
		`${envDir}/compose.yaml`,
		renderComposeFile({
			services: input.services,
			images: input.images,
			hostPorts: input.hostPorts,
			volumes: input.volumes,
			projectName: input.projectName,
			postgres: input.postgres,
			environment: input.environment,
		}),
	)

	if (input.registryToken !== undefined) {
		await loginToRegistries(session, input, input.registryToken)
	}

	await session.exec(`docker compose -p ${siloIdQ} -f ${composeFileQ} pull`)

	await bringUpDb(session, {
		projectName: input.projectName,
		environment: input.environment,
		postgres: input.postgres,
	})
}

/**
 * Write one `.env.<name>` per declared service — the per-service isolation
 * unit the compose `env_file` points at (D5). Every file carries the shared
 * deploy env, the symmetric cross-service URL block (so each service resolves
 * its peers by `<NAME>_URL`), the secrets pool, and its OWN declared port: a
 * hardcoded PORT here would break any service whose `port` differs from a
 * peer's (app on one port, mapping + healthcheck on another).
 */
async function writeServiceEnvFiles(
	session: SshSession,
	envDir: string,
	input: DeployContainerInput,
): Promise<void> {
	const serviceUrls = buildServiceUrlEnv(input.services)

	await Promise.all(
		Object.entries(input.services).map(([name, service]) =>
			session.writeFile(
				`${envDir}/.env.${name}`,
				formatComposeEnv({
					PORT: String(service.port),
					...input.env,
					...serviceUrls,
					...input.secrets,
				}),
			),
		),
	)
}

/**
 * Authenticate docker against the registries the pipeline pushed this deploy's
 * `build` images to, using the single forwarded token. Build images share the
 * GHCR registry, so the set dedupes to one `docker login` in practice;
 * `upstream` images carry their own auth and are pulled without this token.
 * Sequential by necessity: concurrent `docker login` calls race on the shared
 * ~/.docker/config.json.
 */
async function loginToRegistries(
	session: SshSession,
	input: DeployContainerInput,
	token: string,
): Promise<void> {
	const registries = new Set(
		Object.entries(input.services)
			.filter(([, service]) => service.source === 'build')
			.map(([name]) => selectServiceImage(input.images, name).registry),
	)

	for (const registry of registries) {
		// eslint-disable-next-line no-await-in-loop -- docker login serializes on ~/.docker/config.json
		await loginToRegistry(session, registry, token)
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
 * Phase 2: rotate the user workloads. The embedded-postgres pair is brought
 * up in phase 1 (or is absent), and its compose `--wait` already gated it
 * healthy — a re-`up` of the whole file leaves the healthy DB untouched and
 * rotates every user service to its new image. So phase 2 is unconditionally
 * `up -d --remove-orphans` with no positional service (M1 has one user
 * workload; the bare form generalises to the multi-service file in M2/M3) and
 * drops any orphan left by a previous deploy.
 *
 * Load-bearing invariant: both phases act on the SAME compose file rendered
 * from the same `renderComposeFile` inputs, so the postgres block is
 * byte-identical across phases and this bare `up` finds nothing to recreate for
 * it (it only rotates the user services whose image changed). If a future
 * change ever makes the backing-service rendering differ between phase 1 and
 * phase 2, this `up` would recreate the DB it just `--wait`-ed healthy — keep
 * the compose output for postgres/supabase deterministic across both phases.
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
