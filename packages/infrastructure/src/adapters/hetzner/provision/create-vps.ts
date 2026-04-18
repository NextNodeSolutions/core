import { createLogger } from '@nextnode-solutions/logger'

import type { HetznerVpsDeploySection } from '../../../config/types.ts'
import type { ResourceOutcome } from '../../../domain/deploy/resource-outcome.ts'
import {
	renderCloudInit,
	renderProjectCloudInit,
} from '../../../domain/hetzner/cloud-init.ts'
import { computeFirewallRules } from '../../../domain/hetzner/firewall-rules.ts'
import {
	deleteTailnetDevicesByHostname,
	getTailnetIpByHostname,
	mintAuthkey,
} from '../../tailscale/oauth.ts'
import type { CreateServerInput } from '../api/client.ts'
import {
	applyFirewall,
	assertServerTypeAvailable,
	createFirewall,
	createServer,
} from '../api/client.ts'
import {
	HCLOUD_IMAGE,
	TAILSCALE_AUTHKEY_TTL_SECONDS,
	TAILSCALE_TAG,
} from '../constants.ts'

import { waitForServerRunning } from './wait-for-server-running.ts'
import { waitForSsh } from './wait-for-ssh.ts'

const logger = createLogger()

export interface ProvisionVpsCredentials {
	readonly hcloudToken: string
	readonly tailscaleAuthKey: string
	readonly deployPublicKey: string
	readonly deployPrivateKey: string
}

export interface CreateVpsInput {
	readonly projectName: string
	readonly hetzner: HetznerVpsDeploySection['hetzner']
	readonly internal: boolean
	readonly goldenImageId: number | undefined
}

export interface CreateVpsResult {
	readonly serverId: number
	readonly publicIp: string
	readonly outcome: ResourceOutcome
}

export interface CompleteProvisioningInput {
	readonly serverId: number
	readonly projectName: string
	readonly internal: boolean
}

export interface CompleteProvisioningResult {
	readonly tailnetIp: string
	readonly firewallOutcome: ResourceOutcome
	readonly tailscaleOutcome: ResourceOutcome
}

export async function createVps(
	credentials: ProvisionVpsCredentials,
	input: CreateVpsInput,
): Promise<CreateVpsResult> {
	await assertServerTypeAvailable(
		credentials.hcloudToken,
		input.hetzner.serverType,
	)
	logger.info(
		`Preflight OK: server_type "${input.hetzner.serverType}" is available`,
	)

	const purged = await deleteTailnetDevicesByHostname(
		credentials.tailscaleAuthKey,
		input.projectName,
	)
	if (purged > 0) {
		logger.info(
			`Purged ${purged} stale tailnet device(s) with hostname "${input.projectName}"`,
		)
	}

	const minted = await mintAuthkey(
		credentials.tailscaleAuthKey,
		[TAILSCALE_TAG],
		TAILSCALE_AUTHKEY_TTL_SECONDS,
		`nextnode-infra provisioning ${input.projectName}`,
	)
	logger.info(
		`Minted ephemeral Tailscale authkey for "${input.projectName}" (expires ${minted.expires})`,
	)

	const cloudInitInput = {
		tailscaleAuthKey: minted.key,
		tailscaleHostname: input.projectName,
		deployPublicKey: credentials.deployPublicKey,
		internal: input.internal,
	}

	const useGoldenImage = input.goldenImageId !== undefined
	const cloudInit = useGoldenImage
		? renderProjectCloudInit(cloudInitInput)
		: renderCloudInit(cloudInitInput)
	const image = useGoldenImage ? input.goldenImageId.toString() : HCLOUD_IMAGE

	if (useGoldenImage) {
		logger.info(
			`Using golden image ${input.goldenImageId} for "${input.projectName}"`,
		)
	}

	const serverInput: CreateServerInput = {
		name: input.projectName,
		serverType: input.hetzner.serverType,
		location: input.hetzner.location,
		image,
		userData: cloudInit,
		labels: { project: input.projectName, managed_by: 'nextnode' },
	}

	logger.info(
		`Creating VPS "${input.projectName}" (${input.hetzner.serverType} in ${input.hetzner.location})`,
	)
	const server = await createServer(credentials.hcloudToken, serverInput)

	return {
		serverId: server.id,
		publicIp: server.public_net.ipv4.ip,
		outcome: { handled: true, detail: `created #${String(server.id)}` },
	}
}

export async function completeProvisioning(
	credentials: ProvisionVpsCredentials,
	input: CompleteProvisioningInput,
): Promise<CompleteProvisioningResult> {
	await waitForServerRunning(credentials.hcloudToken, input.serverId)

	const firewallName = `${input.projectName}-fw`
	logger.info(`Ensuring firewall "${firewallName}"`)
	const firewall = await createFirewall(
		credentials.hcloudToken,
		firewallName,
		computeFirewallRules(input.internal),
	)
	await applyFirewall(credentials.hcloudToken, firewall.id, input.serverId)

	const tailnetIp = await getTailnetIpByHostname(
		credentials.tailscaleAuthKey,
		input.projectName,
	)
	logger.info(`Tailnet IP for "${input.projectName}": ${tailnetIp}`)

	await waitForSsh({
		host: tailnetIp,
		privateKey: credentials.deployPrivateKey,
	})

	return {
		tailnetIp,
		firewallOutcome: { handled: true, detail: `created "${firewallName}"` },
		tailscaleOutcome: {
			handled: true,
			detail: `joined (${tailnetIp})`,
		},
	}
}
