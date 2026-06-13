import { computeSiteUrl } from '#/domain/deploy/domain.ts'
import { computeVpsDnsRecords } from '#/domain/hetzner/dns-records.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { executeMigrate, executeSnapshot } from './migrate.ts'
import { freshProvision, resumeFromState } from './provision/ensure-infra.ts'
import { openVpsSession, runDeploy, runPrepareRollout } from './rollout.ts'
import { readState } from './state/read-write.ts'
import { runHetznerTeardown } from './teardown.ts'

import type {
	DeployVolume,
	HetznerVpsDeploySection,
	ObservabilityServiceConfig,
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
import type { RolloutContext } from './rollout.ts'

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
	readonly observability: ObservabilityServiceConfig | undefined
	// User workloads from [deploy.services.<name>], threaded into the compose
	// renderer via deployContainer / stageRollout.
	readonly services: Readonly<Record<string, UserServiceConfig>>
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
		const { vpsName } = this.config
		const existing = await readState(this.r2, vpsName)

		const outcome = existing
			? await resumeFromState(
					{ config: this.config, r2: this.r2, vpsName },
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
		const { vpsName } = this.config
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
		const { vpsName } = this.config
		const existing = await readState(this.r2, vpsName)
		if (!existing || existing.state.phase === 'created') {
			throw new Error(
				`Invariant: expected deployable state for VPS "${vpsName}"`,
			)
		}
		const { state } = existing

		// One A record per routed service (a service declaring a `url`), at its
		// per-environment hostname - the same set buildServiceUpstreams routes and
		// composeCaddyConfig requests certs for. A project routes via its service
		// urls, not the bare project `domain`, so the records derive from them;
		// internal-only services (no url) get no record.
		const serviceDomains = Object.values(this.config.services).flatMap(
			service => (service.url === undefined ? [] : [service.url]),
		)
		// The observability vhosts (logs./metrics.) route like any service
		// url: they need their A records at the same per-environment
		// hostname Caddy serves and requests certs for.
		const observabilityDomains = this.config.observability
			? [
					this.config.observability.logsVhost,
					this.config.observability.metricsVhost,
				]
			: []
		const records = [...serviceDomains, ...observabilityDomains].flatMap(
			recordDomain =>
				computeVpsDnsRecords({
					domain: recordDomain,
					environment: this.config.environment,
					publicIp: state.publicIp,
					internal: this.config.internal,
					tailnetIp: state.tailnetIp,
				}),
		)

		await this.config.dns.reconcile(records)
		logger.info(
			`DNS reconciled for "${projectName}" (${domain}) on VPS "${vpsName}" (${this.config.environment}): ${String(records.length)} record(s)`,
		)
	}

	contributeEnv(): TargetEnv {
		return {
			public: {
				SITE_URL: computeSiteUrl(
					this.config.domain,
					this.config.environment,
				),
			},
			secret: {},
		}
	}

	deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		return runDeploy(this.rolloutContext(), projectName, input, env)
	}

	prepareRollout(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<void> {
		return runPrepareRollout(this.rolloutContext(), projectName, input, env)
	}

	async runMigrate(input: MigrateInput): Promise<MigrateResult> {
		const session = await openVpsSession(this.rolloutContext())
		try {
			return await executeMigrate(session, input)
		} finally {
			session.close()
		}
	}

	async runPreMigrateSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
		const session = await openVpsSession(this.rolloutContext())
		try {
			return await executeSnapshot(session, input)
		} finally {
			session.close()
		}
	}

	private rolloutContext(): RolloutContext {
		return { config: this.config, r2: this.r2 }
	}

	teardown(
		projectName: string,
		domain: string | undefined,
		target: TeardownTarget,
		shouldWipeVolumes: boolean,
	): Promise<TeardownResult> {
		return runHetznerTeardown({
			projectName,
			vpsName: this.config.vpsName,
			domain,
			services: this.config.services,
			target,
			shouldWipeVolumes,
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
