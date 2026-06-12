import { composeCaddyConfig } from '#/domain/caddy/compose.ts'
import { extractUpstreams } from '#/domain/caddy/config.ts'
import { CADDY_ENV_PATH, renderCaddyEnv } from '#/domain/caddy/env.ts'
import { buildR2CaddyBinding } from '#/domain/cloudflare/r2/caddy-binding.ts'
import { allocateHostPort } from '#/domain/hetzner/host-port.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { deployContainer, stageRollout } from './deploy-container.ts'
import { createSshSession } from './ssh/session.ts'
import { readState, writeState } from './state/read-write.ts'
import { releaseProjectHostPort } from './teardown-project.ts'

import type { CaddyUpstream } from '#/domain/caddy/config.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	ImageRef,
} from '#/domain/deploy/target.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import type { DeployContainerInput } from './deploy-container.ts'
import type { SshSession } from './ssh/session.types.ts'
import type {
	HcloudConvergedState,
	HcloudProvisionedState,
} from './state/types.ts'
import type { HetznerVpsTargetConfig } from './target.ts'

const logger = createLogger()

// The (config, state store) pair every rollout step threads through -
// the SSH-facing slice of HetznerVpsTarget.
export interface RolloutContext {
	readonly config: HetznerVpsTargetConfig
	readonly r2: ObjectStoreClient
}

type DeployableState = HcloudProvisionedState | HcloudConvergedState

interface DeployableStateRef {
	readonly state: DeployableState
	readonly etag: string
}

/**
 * Read the VPS state and require it to be past phase=created - the
 * invariant every SSH-facing operation (deploy, rollout, migrate) holds.
 */
async function requireDeployableState(
	ctx: RolloutContext,
): Promise<DeployableStateRef> {
	const existing = await readState(ctx.r2, ctx.config.vpsName)
	if (!existing || existing.state.phase === 'created') {
		throw new Error(
			`Invariant: expected deployable state for VPS "${ctx.config.vpsName}"`,
		)
	}
	return { state: existing.state, etag: existing.etag }
}

/**
 * Open an SSH session to the VPS as the deploy user, pinned to the host
 * key fingerprint captured at provision time. Used directly by migrate /
 * snapshot; rollouts go through `openRolloutSession` for port allocation.
 */
export async function openVpsSession(ctx: RolloutContext): Promise<SshSession> {
	const { state } = await requireDeployableState(ctx)
	return createSshSession({
		host: state.tailnetIp,
		username: 'deploy',
		privateKey: ctx.config.credentials.deployPrivateKey,
		expectedHostKeyFingerprint: state.sshHostKeyFingerprint,
	})
}

export function requireImages(
	input: DeployInput,
): Readonly<Record<string, ImageRef>> {
	if (!input.images) {
		throw new Error('images are required for Hetzner VPS deploys')
	}
	return input.images
}

// Instance names of the services that face the reverse proxy (declare a
// `url`) and therefore need a host port. Internal-only services expose none.
function urlServiceNames(ctx: RolloutContext): ReadonlyArray<string> {
	return Object.entries(ctx.config.services)
		.filter(([, service]) => service.url !== undefined)
		.map(([name]) => name)
}

/**
 * Resolve the deploy state (host port + tailnet IP + host key) and
 * open an SSH session, in the order both `runDeploy` and
 * `runPrepareRollout` need it. The host port is allocated lazily
 * here: if the project doesn't already have a port mapped on this
 * VPS, allocate one and persist via `writeState` BEFORE the SSH work
 * begins. Re-entrant: re-running through migrate-remote → deploy in
 * the same pipeline reuses the same port because `allocateHostPort`
 * is idempotent for already-mapped projects.
 */
async function openRolloutSession(
	ctx: RolloutContext,
	projectName: string,
	input: DeployInput,
): Promise<{
	readonly session: SshSession
	readonly hostPorts: Readonly<Record<string, number>>
	readonly hasAllocated: boolean
}> {
	requireImages(input)
	const { vpsName } = ctx.config

	const existing = await requireDeployableState(ctx)

	const { ports: hostPorts, hasAllocated } = allocateHostPort(
		existing.state.hostPorts,
		projectName,
		urlServiceNames(ctx),
	)
	if (hasAllocated) {
		const updated: HcloudProvisionedState | HcloudConvergedState = {
			...existing.state,
			hostPorts: {
				...existing.state.hostPorts,
				[projectName]: hostPorts,
			},
		}
		await writeState(ctx.r2, vpsName, updated, existing.etag)
	}

	const session = await createSshSession({
		host: existing.state.tailnetIp,
		username: 'deploy',
		privateKey: ctx.config.credentials.deployPrivateKey,
		expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
	})

	return { session, hostPorts, hasAllocated }
}

// Compensates a freshly-allocated host port when the rollout that
// follows the allocation fails. Without this, every failed deploy on
// a previously-unmapped project leaves a phantom entry in the VPS
// state, hiding that port from future allocations on the same VPS.
//
// Re-reads state before releasing so a concurrent deploy that
// advanced state in the meantime is preserved (writeState ETag).
// Swallows + warns on failure so the original error from the caller
// is not masked.
async function releaseAllocatedHostPort(
	ctx: RolloutContext,
	projectName: string,
): Promise<void> {
	const { vpsName } = ctx.config
	try {
		const fresh = await readState(ctx.r2, vpsName)
		if (!fresh || fresh.state.phase === 'created') return
		await releaseProjectHostPort(projectName, {
			r2: ctx.r2,
			vpsName,
			state: fresh.state,
			etag: fresh.etag,
		})
	} catch (err) {
		logger.warn(
			`Failed to release host port allocation for "${projectName}" on VPS "${vpsName}"; phantom entry may remain in state: ${String(err)}`,
		)
	}
}

// The deployContainer / stageRollout input, assembled identically by the
// full deploy and the prepare-only rollout.
interface ContainerInputSeed {
	readonly projectName: string
	readonly hostPorts: Readonly<Record<string, number>>
	readonly input: DeployInput
	readonly env: DeployEnv
}

function buildContainerInput(
	ctx: RolloutContext,
	{ projectName, hostPorts, input, env }: ContainerInputSeed,
): DeployContainerInput {
	return {
		projectName,
		environment: ctx.config.environment,
		hostPorts,
		env,
		secrets: input.secrets,
		secretOrigins: input.secretOrigins,
		images: requireImages(input),
		registryToken: input.registryToken,
		volumes: ctx.config.volumes,
		postgres: ctx.config.postgres,
		services: ctx.config.services,
	}
}

/**
 * Multi-tenant Caddy reconfiguration: read the existing config, drop any
 * prior upstreams for THIS project's hostnames (re-deploy case), then add
 * the fresh ones. Upstreams from other projects on this VPS are preserved
 * untouched.
 */
async function reconcileCaddy(
	session: SshSession,
	ctx: RolloutContext,
	upstreams: ReadonlyArray<CaddyUpstream>,
): Promise<void> {
	const { vpsName } = ctx.config
	const existingConfig = await session.readFile(CADDY_CONFIG_PATH)
	const existingUpstreams = extractUpstreams(existingConfig ?? '')
	const deployedHostnames = new Set(upstreams.map(u => u.hostname))
	const otherUpstreams = existingUpstreams.filter(
		u => !deployedHostnames.has(u.hostname),
	)
	const mergedUpstreams = [...otherUpstreams, ...upstreams]

	const caddyConfig = JSON.stringify(
		composeCaddyConfig({
			storage: buildR2CaddyBinding(ctx.config.infraStorage, vpsName),
			upstreams: mergedUpstreams,
			acmeEmail: ctx.config.acmeEmail,
			internal: ctx.config.internal,
		}),
	)

	// Refresh the env file so Caddy resolves the latest R2 + CF
	// secrets via {env.X} placeholders. Caddy re-reads EnvironmentFile
	// on systemctl restart only, so a rotation needs a restart - but
	// for normal deploys the values are unchanged and `caddy reload`
	// suffices.
	await session.writeFile(
		CADDY_ENV_PATH,
		renderCaddyEnv({
			infraStorage: ctx.config.infraStorage,
			cloudflareApiToken: ctx.config.cloudflareApiToken,
		}),
	)
	await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
	await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
	logger.info(
		`Caddy reloaded on VPS "${vpsName}" with ${String(mergedUpstreams.length)} upstream(s)`,
	)
}

/** Full deploy: container rollout + Caddy route reconciliation. */
export async function runDeploy(
	ctx: RolloutContext,
	projectName: string,
	input: DeployInput,
	env: DeployEnv,
): Promise<DeployResult> {
	const start = Date.now()
	const { session, hostPorts, hasAllocated } = await openRolloutSession(
		ctx,
		projectName,
		input,
	)

	try {
		const { upstreams, deployed } = await deployContainer(
			session,
			buildContainerInput(ctx, { projectName, hostPorts, input, env }),
		)
		await reconcileCaddy(session, ctx, upstreams)

		return {
			projectName,
			deployedEnvironments: [deployed],
			durationMs: Date.now() - start,
		}
	} catch (err) {
		if (hasAllocated) await releaseAllocatedHostPort(ctx, projectName)
		throw err
	} finally {
		session.close()
	}
}

/** Phase-1-only rollout: stage files + pull + bring the DB up, no rotation. */
export async function runPrepareRollout(
	ctx: RolloutContext,
	projectName: string,
	input: DeployInput,
	env: DeployEnv,
): Promise<void> {
	const { session, hostPorts, hasAllocated } = await openRolloutSession(
		ctx,
		projectName,
		input,
	)

	try {
		await stageRollout(
			session,
			buildContainerInput(ctx, { projectName, hostPorts, input, env }),
		)
	} catch (err) {
		if (hasAllocated) await releaseAllocatedHostPort(ctx, projectName)
		throw err
	} finally {
		session.close()
	}
}
