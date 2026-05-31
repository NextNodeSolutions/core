import { composeCaddyConfig } from '#/domain/caddy/compose.ts'
import { extractUpstreams } from '#/domain/caddy/config.ts'
import { CADDY_ENV_PATH, renderCaddyEnv } from '#/domain/caddy/env.ts'
import { buildR2CaddyBinding } from '#/domain/cloudflare/r2/caddy-binding.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { computeVpsDnsRecords } from '#/domain/hetzner/dns-records.ts'
import { allocateHostPort } from '#/domain/hetzner/host-port.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { deployContainer, stageRollout } from './deploy-container.ts'
import { executeMigrate, executeSnapshot } from './migrate.ts'
import { freshProvision, resumeFromState } from './provision/ensure-infra.ts'
import { createSshSession } from './ssh/session.ts'
import { readState, writeState } from './state/read-write.ts'
import { releaseProjectHostPort } from './teardown-project.ts'
import { runHetznerTeardown } from './teardown.ts'

import type {
	DeployVolume,
	HetznerVpsDeploySection,
	PostgresServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { VpsResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	ImageRef,
	MigrateInput,
	MigrateResult,
	SnapshotInput,
	SnapshotResult,
	TargetEnv,
	VpsProvisionResult,
} from '#/domain/deploy/target.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { DnsClient } from '#/domain/dns/client.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import type { TailnetClient } from '#/domain/tailnet/client.ts'
import type { SshSession } from './ssh/session.types.ts'
import type {
	HcloudConvergedState,
	HcloudProvisionedState,
} from './state/types.ts'

const logger = createLogger()

export interface HetznerCredentials {
	readonly hcloudToken: string
	readonly deployPrivateKey: string
	readonly deployPublicKey: string
	readonly tailnet: TailnetClient
}

export interface HetznerVectorConfig {
	readonly clientId: string
	readonly vlUrl: string
}

export interface HetznerVpsTargetConfig {
	readonly vpsName: string
	readonly hetzner: HetznerVpsDeploySection['hetzner']
	readonly volumes: ReadonlyArray<DeployVolume>
	readonly postgres: PostgresServiceConfig | undefined
	// User workloads from [deploy.services.<name>], threaded into the compose
	// renderer via deployContainer / stageRollout.
	readonly services: Record<string, UserServiceConfig>
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly stateStore: ObjectStoreClient
	readonly certsStore: ObjectStoreClient
	readonly environment: AppEnvironment
	readonly domain: string
	readonly internal: boolean
	readonly credentials: HetznerCredentials
	readonly vector: HetznerVectorConfig | null
	readonly dns: DnsClient
	readonly cloudflareApiToken: string
	readonly acmeEmail: string
}

export class HetznerVpsTarget implements DeployTarget {
	readonly name = 'hetzner-vps'
	private readonly config: HetznerVpsTargetConfig
	private readonly r2: ObjectStoreClient
	private readonly certsR2: ObjectStoreClient

	constructor(config: HetznerVpsTargetConfig) {
		this.config = config
		this.r2 = config.stateStore
		this.certsR2 = config.certsStore
	}

	async ensureInfra(projectName: string): Promise<VpsProvisionResult> {
		const start = Date.now()
		// projectName is unused for VPS provisioning: provisioning is keyed
		// by vpsName so multiple projects on the same shared VPS reuse the
		// same provisioned host. The DeployTarget interface still passes it
		// for symmetry with deploy()/reconcileDns().
		void projectName
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)

		const outcome = existing
			? await resumeFromState(
					this.config,
					this.r2,
					vpsName,
					existing.state,
					existing.etag,
				)
			: await freshProvision(this.config, this.r2, vpsName)

		return this.readProvisionResult(start, outcome)
	}

	private async readProvisionResult(
		startMs: number,
		outcome: VpsResourceOutcome,
	): Promise<VpsProvisionResult> {
		const vpsName = this.config.vpsName
		const finalState = await readState(this.r2, vpsName)
		if (!finalState || finalState.state.phase === 'created') {
			throw new Error(
				`Provisioning did not reach a deployable state for VPS "${vpsName}"`,
			)
		}

		return {
			kind: 'vps',
			outcome,
			serverId: finalState.state.serverId,
			serverType: this.config.hetzner.serverType,
			location: this.config.hetzner.location,
			publicIp: finalState.state.publicIp,
			tailnetIp: finalState.state.tailnetIp,
			durationMs: Date.now() - startMs,
		}
	}

	async reconcileDns(projectName: string, domain: string): Promise<void> {
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}

		const records = computeVpsDnsRecords({
			domain,
			environment: this.config.environment,
			publicIp: existing.state.publicIp,
			internal: this.config.internal,
			tailnetIp: existing.state.tailnetIp,
		})

		await this.config.dns.reconcile(records)
		logger.info(
			`DNS reconciled for "${projectName}" on VPS "${vpsName}" (${this.config.environment})`,
		)
	}

	contributeEnv(): TargetEnv {
		return {
			public: {
				SITE_URL: `https://${resolveDeployDomain(this.config.domain, this.config.environment)}`,
			},
			secret: {},
		}
	}

	async deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		const start = Date.now()
		const vpsName = this.config.vpsName
		const { session, hostname, hostPort, allocated } =
			await this.openRolloutSession(projectName, input)

		try {
			const { upstream, deployed } = await deployContainer(session, {
				projectName,
				environment: this.config.environment,
				hostname,
				hostPort,
				env,
				secrets: input.secrets,
				images: this.requireImages(input),
				registryToken: input.registryToken,
				volumes: this.config.volumes,
				postgres: this.config.postgres,
				services: this.config.services,
			})

			// Multi-tenant Caddy: read the existing config, drop any prior
			// upstream for THIS project's hostname (re-deploy case), then add
			// the fresh one. Upstreams from other projects on this VPS are
			// preserved untouched.
			const existingConfig = await session.readFile(CADDY_CONFIG_PATH)
			const existingUpstreams = extractUpstreams(existingConfig ?? '')
			const otherUpstreams = existingUpstreams.filter(
				u => u.hostname !== upstream.hostname,
			)
			const mergedUpstreams = [...otherUpstreams, upstream]

			const caddyConfig = JSON.stringify(
				composeCaddyConfig({
					storage: buildR2CaddyBinding(
						this.config.infraStorage,
						vpsName,
					),
					upstreams: mergedUpstreams,
					acmeEmail: this.config.acmeEmail,
					internal: this.config.internal,
				}),
			)

			// Refresh the env file so Caddy resolves the latest R2 + CF
			// secrets via {env.X} placeholders. Caddy re-reads EnvironmentFile
			// on systemctl restart only, so a rotation needs a restart — but
			// for normal deploys the values are unchanged and `caddy reload`
			// suffices.
			await session.writeFile(
				CADDY_ENV_PATH,
				renderCaddyEnv({
					infraStorage: this.config.infraStorage,
					cloudflareApiToken: this.config.cloudflareApiToken,
				}),
			)
			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info(
				`Caddy reloaded on VPS "${vpsName}" with ${String(mergedUpstreams.length)} upstream(s)`,
			)

			return {
				projectName,
				deployedEnvironments: [deployed],
				durationMs: Date.now() - start,
			}
		} catch (err) {
			if (allocated) await this.releaseAllocatedHostPort(projectName)
			throw err
		} finally {
			session.close()
		}
	}

	async prepareRollout(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<void> {
		const { session, hostname, hostPort, allocated } =
			await this.openRolloutSession(projectName, input)

		try {
			await stageRollout(session, {
				projectName,
				environment: this.config.environment,
				hostname,
				hostPort,
				env,
				secrets: input.secrets,
				images: this.requireImages(input),
				registryToken: input.registryToken,
				volumes: this.config.volumes,
				postgres: this.config.postgres,
				services: this.config.services,
			})
		} catch (err) {
			if (allocated) await this.releaseAllocatedHostPort(projectName)
			throw err
		} finally {
			session.close()
		}
	}

	async runMigrate(input: MigrateInput): Promise<MigrateResult> {
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'deploy',
			privateKey: this.config.credentials.deployPrivateKey,
			expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
		})

		try {
			return await executeMigrate(session, input)
		} finally {
			session.close()
		}
	}

	async runPreMigrateSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
		const vpsName = this.config.vpsName
		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'deploy',
			privateKey: this.config.credentials.deployPrivateKey,
			expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
		})

		try {
			return await executeSnapshot(session, input)
		} finally {
			session.close()
		}
	}

	/**
	 * Resolve the deploy state (host port + tailnet IP + host key) and
	 * open an SSH session, in the order both `deploy` and
	 * `prepareRollout` need it. The host port is allocated lazily
	 * here: if the project doesn't already have a port mapped on this
	 * VPS, allocate one and persist via `writeState` BEFORE the SSH work
	 * begins. Re-entrant: re-running through migrate-remote → deploy in
	 * the same pipeline reuses the same port because `allocateHostPort`
	 * is idempotent for already-mapped projects.
	 */
	private async openRolloutSession(
		projectName: string,
		input: DeployInput,
	): Promise<{
		readonly session: SshSession
		readonly hostname: string
		readonly hostPort: number
		readonly allocated: boolean
	}> {
		this.requireImages(input)
		const vpsName = this.config.vpsName
		const hostname = resolveDeployDomain(
			this.config.domain,
			this.config.environment,
		)

		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}

		const { port: hostPort, allocated } = allocateHostPort(
			existing.state.hostPorts,
			projectName,
		)
		if (allocated) {
			const updated: HcloudProvisionedState | HcloudConvergedState = {
				...existing.state,
				hostPorts: {
					...existing.state.hostPorts,
					[projectName]: hostPort,
				},
			}
			await writeState(this.r2, vpsName, updated, existing.etag)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'deploy',
			privateKey: this.config.credentials.deployPrivateKey,
			expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
		})

		return { session, hostname, hostPort, allocated }
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
	private async releaseAllocatedHostPort(projectName: string): Promise<void> {
		const vpsName = this.config.vpsName
		try {
			const fresh = await readState(this.r2, vpsName)
			if (!fresh || fresh.state.phase === 'created') return
			await releaseProjectHostPort(
				this.r2,
				vpsName,
				projectName,
				fresh.state,
				fresh.etag,
			)
		} catch (err) {
			logger.warn(
				`Failed to release host port allocation for "${projectName}" on VPS "${vpsName}"; phantom entry may remain in state: ${String(err)}`,
			)
		}
	}

	private requireImages(input: DeployInput): Record<string, ImageRef> {
		if (!input.images) {
			throw new Error('images are required for Hetzner VPS deploys')
		}
		return input.images
	}

	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		withVolumes: boolean,
	): Promise<TeardownResult> {
		return runHetznerTeardown({
			projectName,
			vpsName: this.config.vpsName,
			domain,
			target,
			withVolumes,
			environment: this.config.environment,
			internal: this.config.internal,
			hcloudToken: this.config.credentials.hcloudToken,
			tailnet: this.config.credentials.tailnet,
			deployPrivateKey: this.config.credentials.deployPrivateKey,
			dns: this.config.dns,
			r2: this.r2,
			certsR2: this.certsR2,
			infraStorage: this.config.infraStorage,
			acmeEmail: this.config.acmeEmail,
		})
	}
}
