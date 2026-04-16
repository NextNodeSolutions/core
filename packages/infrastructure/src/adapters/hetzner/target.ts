import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { converge } from '../../cli/hetzner/converge.ts'
import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import { resolveDeployDomain } from '../../domain/deploy/domain.ts'
import type {
	ContainerDeployedEnvironment,
	DeployEnv,
	DeployInput,
	DeployResult,
	DeployTarget,
	ImageRef,
} from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import type { CaddyUpstream } from '../../domain/hetzner/caddy-config.ts'
import { buildCaddyConfig } from '../../domain/hetzner/caddy-config.ts'
import { renderCloudInit } from '../../domain/hetzner/cloud-init.ts'
import { formatComposeEnv } from '../../domain/hetzner/compose-env.ts'
import {
	CONTAINER_PORT,
	computeHostPort,
	renderComposeFile,
} from '../../domain/hetzner/compose-file.ts'
import { computeSilo } from '../../domain/hetzner/env-silo.ts'
import { renderVectorEnv } from '../../domain/hetzner/vector-env.ts'
import { renderVectorToml } from '../../domain/hetzner/vector-toml.ts'
import { R2Client } from '../r2/client.ts'
import {
	deleteTailnetDevicesByHostname,
	getTailnetIpByHostname,
	mintAuthkey,
} from '../tailscale/oauth.ts'

import type { CreateServerInput } from './hcloud-client.ts'
import {
	applyFirewall,
	assertServerTypeAvailable,
	createFirewall,
	createServer,
	describeServer,
	ensureSshKey,
} from './hcloud-client.ts'
import type { FirewallRule } from './hcloud-firewall.ts'
import { readState, writeState } from './hcloud-state.ts'
import { createSshSession } from './ssh-session.ts'
import type { SshSession } from './ssh-session.types.ts'

const logger = createLogger()

const HCLOUD_IMAGE = 'debian-12'
const SSH_KEY_NAME = 'nextnode-ci'
const POLL_INTERVAL_MS = 5_000
const MAX_POLL_ATTEMPTS = 24
const SSH_RETRY_INTERVAL_MS = 5_000
const MAX_SSH_ATTEMPTS = 12
const TAILSCALE_AUTHKEY_TTL_SECONDS = 600
const TAILSCALE_TAG = 'tag:ci'

const CADDY_CONFIG_PATH = '/etc/caddy/config.json'

const FIREWALL_RULES: ReadonlyArray<FirewallRule> = [
	{
		description: 'HTTP',
		direction: 'in',
		protocol: 'tcp',
		port: '80',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'HTTPS',
		direction: 'in',
		protocol: 'tcp',
		port: '443',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'SSH',
		direction: 'in',
		protocol: 'tcp',
		port: '22',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
]

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) {
		throw new Error(`${name} env var is required`)
	}
	return value
}

export interface HetznerVpsTargetConfig {
	readonly hetzner: HetznerVpsDeploySection['hetzner']
	readonly r2: R2RuntimeConfig
	readonly environment: AppEnvironment
	readonly domain: string
}

export class HetznerVpsTarget implements DeployTarget {
	readonly name = 'hetzner-vps'
	private readonly hetzner: HetznerVpsDeploySection['hetzner']
	private readonly r2Config: R2RuntimeConfig
	private readonly environment: AppEnvironment
	private readonly domain: string
	private readonly hcloudToken: string
	private readonly deployPrivateKey: string
	private readonly deployPublicKey: string
	private readonly tailscaleAuthKey: string
	private readonly r2: R2Client

	constructor(config: HetznerVpsTargetConfig) {
		this.hetzner = config.hetzner
		this.r2Config = config.r2
		this.environment = config.environment
		this.domain = config.domain
		this.hcloudToken = requireEnv('HETZNER_API_TOKEN')
		this.deployPrivateKey = requireEnv('DEPLOY_SSH_PRIVATE_KEY')
		this.deployPublicKey = requireEnv('DEPLOY_SSH_PUBLIC_KEY')
		this.tailscaleAuthKey = requireEnv('TAILSCALE_AUTH_KEY')
		this.r2 = new R2Client({
			endpoint: config.r2.endpoint,
			accessKeyId: config.r2.accessKeyId,
			secretAccessKey: config.r2.secretAccessKey,
			bucket: config.r2.stateBucket,
		})
	}

	async ensureInfra(projectName: string): Promise<void> {
		const existing = await readState(this.r2, projectName)

		if (existing) {
			logger.info(
				`VPS already provisioned for "${projectName}" (server ${existing.state.serverId})`,
			)
			await this.runConvergence(existing.state.tailnetIp, projectName)
			return
		}

		await assertServerTypeAvailable(
			this.hcloudToken,
			this.hetzner.serverType,
		)
		logger.info(
			`Preflight OK: server_type "${this.hetzner.serverType}" is available`,
		)

		await ensureSshKey(this.hcloudToken, SSH_KEY_NAME, this.deployPublicKey)
		logger.info(`SSH key "${SSH_KEY_NAME}" ready in Hetzner project`)

		const purged = await deleteTailnetDevicesByHostname(
			this.tailscaleAuthKey,
			projectName,
		)
		if (purged > 0) {
			logger.info(
				`Purged ${purged} stale tailnet device(s) with hostname "${projectName}"`,
			)
		}

		const minted = await mintAuthkey(
			this.tailscaleAuthKey,
			[TAILSCALE_TAG],
			TAILSCALE_AUTHKEY_TTL_SECONDS,
			`nextnode-infra provisioning ${projectName}`,
		)
		logger.info(
			`Minted ephemeral Tailscale authkey for "${projectName}" (expires ${minted.expires})`,
		)

		const cloudInit = renderCloudInit({
			tailscaleAuthKey: minted.key,
			tailscaleHostname: projectName,
			deployPublicKey: this.deployPublicKey,
		})

		const serverInput: CreateServerInput = {
			name: projectName,
			serverType: this.hetzner.serverType,
			location: this.hetzner.location,
			image: HCLOUD_IMAGE,
			sshKeys: [SSH_KEY_NAME],
			userData: cloudInit,
			labels: { project: projectName, managed_by: 'nextnode' },
		}

		logger.info(
			`Creating VPS "${projectName}" (${this.hetzner.serverType} in ${this.hetzner.location})`,
		)
		const server = await createServer(this.hcloudToken, serverInput)

		const publicIp = server.public_net.ipv4.ip
		await this.waitForServerRunning(server.id)

		const firewallName = `${projectName}-fw`
		logger.info(`Creating firewall "${firewallName}"`)
		const firewall = await createFirewall(
			this.hcloudToken,
			firewallName,
			FIREWALL_RULES,
		)
		await applyFirewall(this.hcloudToken, firewall.id, server.id)

		const tailnetIp = await getTailnetIpByHostname(
			this.tailscaleAuthKey,
			projectName,
		)
		logger.info(`Tailnet IP for "${projectName}": ${tailnetIp}`)

		await this.waitForSsh(tailnetIp)
		await this.runConvergence(tailnetIp, projectName)

		await writeState(this.r2, projectName, {
			serverId: server.id,
			publicIp,
			tailnetIp,
		})

		logger.info(`Infrastructure ready for "${projectName}"`)
	}

	async reconcileDns(): Promise<void> {
		throw new Error('reconcileDns not implemented for Hetzner VPS yet')
	}

	computeDeployEnv(): DeployEnv {
		return {
			SITE_URL: `https://${resolveDeployDomain(this.domain, this.environment)}`,
		}
	}

	async deploy(
		projectName: string,
		input: DeployInput,
		env: DeployEnv,
	): Promise<DeployResult> {
		const start = Date.now()

		if (!input.image) {
			throw new Error('image is required for Hetzner VPS deploys')
		}

		const hostname = resolveDeployDomain(this.domain, this.environment)

		const existing = await readState(this.r2, projectName)
		if (!existing) {
			throw new Error(
				`No state for "${projectName}" - run ensureInfra first`,
			)
		}

		const session = await createSshSession({
			host: existing.state.tailnetIp,
			username: 'root',
			privateKey: this.deployPrivateKey,
		})

		try {
			const { upstream, deployed } = await this.deployEnvironment(
				session,
				projectName,
				hostname,
				env,
				input.secrets,
				input.image,
			)

			const caddyConfig = JSON.stringify(
				buildCaddyConfig({
					upstreams: [upstream],
					r2Storage: {
						host: this.r2Config.endpoint,
						bucket: this.r2Config.certsBucket,
						accessId: this.r2Config.accessKeyId,
						secretKey: this.r2Config.secretAccessKey,
						prefix: `${projectName}/`,
					},
				}),
			)

			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info('Caddy config reloaded')

			return {
				projectName,
				deployedEnvironments: [deployed],
				durationMs: Date.now() - start,
			}
		} finally {
			session.close()
		}
	}

	private async deployEnvironment(
		session: SshSession,
		projectName: string,
		hostname: string,
		env: DeployEnv,
		secrets: Readonly<Record<string, string>>,
		image: ImageRef,
	): Promise<{
		upstream: CaddyUpstream
		deployed: ContainerDeployedEnvironment
	}> {
		const silo = computeSilo(projectName, this.environment)
		const hostPort = computeHostPort(this.environment)
		const envDir = `/opt/apps/${projectName}/${this.environment}`

		const allEnv = {
			PORT: String(CONTAINER_PORT),
			...env,
			...secrets,
		}
		await session.writeFile(`${envDir}/.env`, formatComposeEnv(allEnv))
		await session.writeFile(
			`${envDir}/compose.yaml`,
			renderComposeFile({ image, hostPort }),
		)

		await session.exec(
			`docker compose -p ${silo.id} -f ${envDir}/compose.yaml pull`,
		)
		await session.exec(
			`docker compose -p ${silo.id} -f ${envDir}/compose.yaml up -d --remove-orphans`,
		)

		logger.info(`Deployed ${silo.id} on port ${hostPort}`)

		return {
			upstream: {
				hostname,
				dial: `localhost:${hostPort}`,
			},
			deployed: {
				kind: 'container',
				name: this.environment,
				imageRef: image,
				url: env.SITE_URL,
				deployedAt: new Date(),
			},
		}
	}

	private async waitForServerRunning(serverId: number): Promise<void> {
		for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
			const server = await describeServer(this.hcloudToken, serverId) // oxlint-disable-line no-await-in-loop -- sequential polling by design
			if (server.status === 'running') {
				logger.info(`Server ${serverId} is running`)
				return
			}
			logger.info(
				`Server ${serverId} status: ${server.status} (attempt ${attempt}/${MAX_POLL_ATTEMPTS})`,
			)
			await sleep(POLL_INTERVAL_MS) // oxlint-disable-line no-await-in-loop -- sequential polling by design
		}
		throw new Error(
			`Server ${serverId} did not reach "running" after ${MAX_POLL_ATTEMPTS} attempts`,
		)
	}

	private async waitForSsh(host: string): Promise<void> {
		for (let attempt = 1; attempt <= MAX_SSH_ATTEMPTS; attempt++) {
			try {
				// oxlint-disable-next-line no-await-in-loop -- sequential retry by design
				const session = await createSshSession({
					host,
					username: 'root',
					privateKey: this.deployPrivateKey,
				})
				session.close()
				logger.info(`SSH reachable at ${host}`)
				return
			} catch {
				logger.info(
					`SSH not ready at ${host} (attempt ${attempt}/${MAX_SSH_ATTEMPTS})`,
				)
				await sleep(SSH_RETRY_INTERVAL_MS) // oxlint-disable-line no-await-in-loop -- sequential retry by design
			}
		}

		throw new Error(
			`SSH to ${host} not reachable after ${MAX_SSH_ATTEMPTS} attempts`,
		)
	}

	private async runConvergence(
		host: string,
		projectName: string,
	): Promise<void> {
		const session = await createSshSession({
			host,
			username: 'root',
			privateKey: this.deployPrivateKey,
		})

		try {
			logger.info('Waiting for cloud-init to finish…')
			await session.exec('cloud-init status --wait')
			logger.info('cloud-init complete')

			const caddyBaseConfig = JSON.stringify(
				buildCaddyConfig({
					upstreams: [],
					r2Storage: {
						host: this.r2Config.endpoint,
						bucket: this.r2Config.certsBucket,
						accessId: this.r2Config.accessKeyId,
						secretKey: this.r2Config.secretAccessKey,
						prefix: `${projectName}/`,
					},
				}),
			)

			const vlUrl = process.env['NN_VL_URL']
			const vectorConfig = vlUrl
				? {
						vectorToml: renderVectorToml(),
						vectorEnv: renderVectorEnv({
							clientId: requireEnv('NN_CLIENT_ID'),
							project: projectName,
							vlUrl,
						}),
					}
				: { vectorToml: undefined, vectorEnv: undefined }

			await converge(session, {
				projectName,
				...vectorConfig,
				caddyBaseConfig,
			})
		} finally {
			session.close()
		}
	}
}
