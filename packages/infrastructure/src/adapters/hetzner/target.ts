import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'

import { converge } from '../../cli/hetzner/converge.ts'
import type { HetznerVpsDeploySection } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import type {
	ContainerDeployConfig,
	ContainerDeployedEnvironment,
	DeployResult,
	DeployTarget,
	EnvironmentDeployConfig,
	ImageRef,
} from '../../domain/deploy/target.ts'
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
import { mintAuthkey } from '../tailscale/oauth.ts'

import type { CreateServerInput } from './hcloud-client.ts'
import {
	applyFirewall,
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

export class HetznerVpsTarget implements DeployTarget<ContainerDeployConfig> {
	readonly name = 'hetzner-vps'
	private readonly hetzner: HetznerVpsDeploySection['hetzner']
	private readonly r2Config: R2RuntimeConfig
	private readonly hcloudToken: string
	private readonly deployPrivateKey: string
	private readonly deployPublicKey: string
	private readonly tailscaleAuthKey: string
	private readonly r2: R2Client

	constructor(
		hetzner: HetznerVpsDeploySection['hetzner'],
		r2: R2RuntimeConfig,
	) {
		this.hetzner = hetzner
		this.r2Config = r2
		this.hcloudToken = requireEnv('HETZNER_API_TOKEN')
		this.deployPrivateKey = requireEnv('DEPLOY_SSH_PRIVATE_KEY')
		this.deployPublicKey = requireEnv('DEPLOY_SSH_PUBLIC_KEY')
		this.tailscaleAuthKey = requireEnv('TAILSCALE_AUTH_KEY')
		this.r2 = new R2Client({
			endpoint: r2.endpoint,
			accessKeyId: r2.accessKeyId,
			secretAccessKey: r2.secretAccessKey,
			bucket: r2.stateBucket,
		})
	}

	async ensureInfra(projectName: string): Promise<void> {
		const existing = await readState(this.r2, projectName)

		if (existing) {
			logger.info(
				`VPS already provisioned for "${projectName}" (server ${existing.state.serverId})`,
			)
			await this.runConvergence(existing.state.ip, projectName)
			return
		}

		await ensureSshKey(this.hcloudToken, SSH_KEY_NAME, this.deployPublicKey)
		logger.info(`SSH key "${SSH_KEY_NAME}" ready in Hetzner project`)

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

		const firewallName = `${projectName}-fw`
		logger.info(`Creating firewall "${firewallName}"`)
		const firewall = await createFirewall(
			this.hcloudToken,
			firewallName,
			FIREWALL_RULES,
		)
		await applyFirewall(this.hcloudToken, firewall.id, server.id)

		const ip = server.public_net.ipv4.ip
		await this.waitForServerRunning(server.id)
		await this.waitForSsh(ip)
		await this.runConvergence(ip, projectName)

		await writeState(this.r2, projectName, {
			serverId: server.id,
			ip,
			tailnetHostname: `${projectName}.tail0.ts.net`,
		})

		logger.info(`Infrastructure ready for "${projectName}"`)
	}

	async deploy(config: ContainerDeployConfig): Promise<DeployResult> {
		const start = Date.now()

		const existing = await readState(this.r2, config.projectName)
		if (!existing) {
			throw new Error(
				`No state for "${config.projectName}" - run ensureInfra first`,
			)
		}

		const session = await createSshSession({
			host: existing.state.ip,
			username: 'root',
			privateKey: this.deployPrivateKey,
		})

		try {
			const upstreams: CaddyUpstream[] = []
			const deployed: ContainerDeployedEnvironment[] = []

			for (const env of config.environments) {
				// oxlint-disable-next-line no-await-in-loop -- shared SSH session, per-env ops must serialize
				const result = await this.deployEnvironment(
					session,
					env,
					config.projectName,
					config.image,
				)
				upstreams.push(result.upstream)
				deployed.push(result.deployed)
			}

			const caddyConfig = JSON.stringify(
				buildCaddyConfig({
					upstreams,
					r2Storage: {
						host: this.r2Config.endpoint,
						bucket: this.r2Config.certsBucket,
						accessId: this.r2Config.accessKeyId,
						secretKey: this.r2Config.secretAccessKey,
						prefix: `${config.projectName}/`,
					},
				}),
			)

			await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
			await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
			logger.info('Caddy config reloaded')

			return {
				projectName: config.projectName,
				deployedEnvironments: deployed,
				durationMs: Date.now() - start,
			}
		} finally {
			session.close()
		}
	}

	private async deployEnvironment(
		session: SshSession,
		env: EnvironmentDeployConfig,
		projectName: string,
		image: ImageRef,
	): Promise<{
		upstream: CaddyUpstream
		deployed: ContainerDeployedEnvironment
	}> {
		const silo = computeSilo(projectName, env.name)
		const hostPort = computeHostPort(env.name)
		const envDir = `/opt/apps/${projectName}/${env.name}`

		const allEnv = {
			PORT: String(CONTAINER_PORT),
			...env.envVars,
			...env.secrets,
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
				hostname: env.hostname,
				dial: `localhost:${hostPort}`,
			},
			deployed: {
				kind: 'container',
				name: env.name,
				imageRef: image,
				url: `https://${env.hostname}`,
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
