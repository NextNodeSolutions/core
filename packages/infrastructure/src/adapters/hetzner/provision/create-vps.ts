import {
	applyFirewall,
	createFirewall,
} from '#/adapters/hetzner/api/firewall.ts'
import type { CreateServerInput } from '#/adapters/hetzner/api/server.ts'
import {
	assertServerTypeAvailable,
	createServer,
	describeServer,
} from '#/adapters/hetzner/api/server.ts'
import {
	MAX_POLL_ATTEMPTS,
	POLL_INTERVAL_MS,
	TAILSCALE_AUTHKEY_TTL_SECONDS,
	TAILSCALE_TAG,
} from '#/adapters/hetzner/constants.ts'
import { waitUntil } from '#/adapters/hetzner/wait.ts'
import type { HetznerVpsDeploySection } from '#/config/types.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import { renderProjectCloudInit } from '#/domain/hetzner/cloud-init.ts'
import { computeFirewallRules } from '#/domain/hetzner/firewall-rules.ts'
import type { TailnetClient } from '#/domain/tailnet/client.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { waitForSsh } from './wait-for-ssh.ts'

const logger = createLogger()

export interface ProvisionVpsCredentials {
	readonly hcloudToken: string
	readonly tailnet: TailnetClient
	readonly deployPublicKey: string
	readonly deployPrivateKey: string
}

export interface CreateVpsInput {
	readonly vpsName: string
	readonly hetzner: HetznerVpsDeploySection['hetzner']
	readonly internal: boolean
	readonly goldenImageId: number
}

export interface CreateVpsResult {
	readonly serverId: number
	readonly publicIp: string
	readonly outcome: ResourceOutcome
}

export interface CompleteProvisioningInput {
	readonly serverId: number
	readonly vpsName: string
	readonly internal: boolean
}

export interface CompleteProvisioningResult {
	readonly tailnetIp: string
	readonly sshHostKeyFingerprint: string
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

	const purged = await credentials.tailnet.deleteByHostname(input.vpsName)
	if (purged > 0) {
		logger.info(
			`Purged ${purged} stale tailnet device(s) with hostname "${input.vpsName}"`,
		)
	}

	const minted = await credentials.tailnet.mintAuthkey(
		[TAILSCALE_TAG],
		TAILSCALE_AUTHKEY_TTL_SECONDS,
		`nextnode-infra provisioning ${input.vpsName}`,
	)
	logger.info(
		`Minted ephemeral Tailscale authkey for "${input.vpsName}" (expires ${minted.expires})`,
	)

	const cloudInit = renderProjectCloudInit({
		tailscaleAuthKey: minted.key,
		tailscaleHostname: input.vpsName,
		deployPublicKey: credentials.deployPublicKey,
		internal: input.internal,
	})

	logger.info(
		`Using golden image ${input.goldenImageId} for "${input.vpsName}"`,
	)

	const serverInput: CreateServerInput = {
		name: input.vpsName,
		serverType: input.hetzner.serverType,
		location: input.hetzner.location,
		image: input.goldenImageId.toString(),
		userData: cloudInit,
		labels: {
			vps: input.vpsName,
			managed_by: 'nextnode',
			mode: input.internal ? 'internal' : 'public',
		},
	}

	logger.info(
		`Creating VPS "${input.vpsName}" (${input.hetzner.serverType} in ${input.hetzner.location})`,
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
	await waitUntil({
		subject: `Server ${String(input.serverId)} startup`,
		poll: () => describeServer(credentials.hcloudToken, input.serverId),
		isDone: server => server.status === 'running',
		detail: server => `status=${server.status}`,
		maxAttempts: MAX_POLL_ATTEMPTS,
		intervalMs: POLL_INTERVAL_MS,
	})

	const firewallName = `${input.vpsName}-fw`
	logger.info(`Ensuring firewall "${firewallName}"`)
	const firewall = await createFirewall(
		credentials.hcloudToken,
		firewallName,
		computeFirewallRules(input.internal),
	)
	await applyFirewall(credentials.hcloudToken, firewall.id, input.serverId)

	const tailnetIp = await credentials.tailnet.getIpByHostname(input.vpsName)
	logger.info(`Tailnet IP for "${input.vpsName}": ${tailnetIp}`)

	const { hostKeyFingerprint } = await waitForSsh({
		host: tailnetIp,
		privateKey: credentials.deployPrivateKey,
	})

	return {
		tailnetIp,
		sshHostKeyFingerprint: hostKeyFingerprint,
		firewallOutcome: { handled: true, detail: `created "${firewallName}"` },
		tailscaleOutcome: {
			handled: true,
			detail: `joined (${tailnetIp})`,
		},
	}
}
