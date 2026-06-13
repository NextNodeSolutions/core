import { findImagesByLabels } from '#/adapters/hetzner/api/image.ts'
import { findServerById } from '#/adapters/hetzner/api/server.ts'
import {
	GOLDEN_IMAGE_LABEL,
	GOLDEN_IMAGE_MAX_AGE_MS,
} from '#/adapters/hetzner/constants.ts'
import { deleteState, writeState } from '#/adapters/hetzner/state/read-write.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import { goldenImageFingerprint } from '#/domain/hetzner/golden-image.ts'
import { VPS_MANAGED_RESOURCES } from '#/domain/hetzner/managed-resources.ts'
import { selectGoldenImage } from '#/domain/hetzner/select-golden-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { buildGoldenImage } from './build-golden-image.ts'
import { createVps } from './create-vps.ts'
import { assertModeMatches, findExistingVps } from './existing-vps.ts'
import {
	CERTS_PROVISION_OUTCOME,
	convergeAndWriteState,
	DNS_PROVISION_OUTCOME,
	provisionFromCreated,
} from './finalize-provision.ts'

import type { HcloudVpsState } from '#/adapters/hetzner/state/types.ts'
import type { HetznerVpsTargetConfig } from '#/adapters/hetzner/target.ts'
import type { VpsResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import type { ExistingVpsRef } from './existing-vps.ts'
import type { VpsProvisionContext } from './finalize-provision.ts'

const logger = createLogger()

async function ensureGoldenImage(token: string): Promise<number> {
	const currentFingerprint = goldenImageFingerprint()
	const snapshots = await findImagesByLabels(token, {
		managed_by: GOLDEN_IMAGE_LABEL,
	})

	const decision = selectGoldenImage({
		images: snapshots,
		currentFingerprint,
		nowMs: Date.now(),
		maxAgeMs: GOLDEN_IMAGE_MAX_AGE_MS,
	})

	if (decision.action === 'use') {
		logger.info(`Using golden image: ${decision.reason}`)
		return decision.imageId
	}

	logger.info(`Rebuilding golden image: ${decision.reason}`)
	const built = await buildGoldenImage(token)
	logger.info(
		`Golden image built: snapshot ${built.snapshotId} (fingerprint ${built.fingerprint})`,
	)
	return built.snapshotId
}

export async function freshProvision(
	config: HetznerVpsTargetConfig,
	r2: ObjectStoreClient,
	vpsName: string,
): Promise<VpsResourceOutcome> {
	const existingServer = await findExistingVps(
		config.credentials.hcloudToken,
		vpsName,
	)
	if (existingServer) {
		assertModeMatches(vpsName, existingServer, config.internal)
		logger.info(
			`VPS "${vpsName}" already exists (server #${String(existingServer.serverId)}) - attaching instead of creating`,
		)
		return attachToExistingVps(config, r2, vpsName, existingServer)
	}

	return provisionFreshServer(config, r2, vpsName)
}

// Create the server from the golden image, seed phase=created state, and
// run the shared provisioning tail.
async function provisionFreshServer(
	config: HetznerVpsTargetConfig,
	r2: ObjectStoreClient,
	vpsName: string,
): Promise<VpsResourceOutcome> {
	const goldenImageId = await ensureGoldenImage(
		config.credentials.hcloudToken,
	)

	const {
		serverId,
		publicIp,
		outcome: serverOutcome,
	} = await createVps(config.credentials, {
		vpsName,
		hetzner: config.hetzner,
		internal: config.internal,
		goldenImageId,
		hasObservability: config.observability !== undefined,
	})

	const createdEtag = await writeState(r2, vpsName, {
		phase: 'created',
		serverId,
		publicIp,
		hostPorts: {},
	})
	logger.info(
		`State written: phase=created for VPS "${vpsName}" (server ${serverId})`,
	)

	return provisionFromCreated(
		{ config, r2, vpsName },
		{
			serverId,
			publicIp,
			hostPorts: {},
			serverOutcome,
			createdEtag,
			vpsLabel: 'VPS',
		},
	)
}

export async function resumeFromState(
	context: VpsProvisionContext,
	state: HcloudVpsState,
	etag: string,
): Promise<VpsResourceOutcome> {
	const { config, r2, vpsName } = context
	const server = await findServerById(
		config.credentials.hcloudToken,
		state.serverId,
	)
	if (!server) {
		logger.warn(
			`Server ${state.serverId} not found - state is stale, wiping and re-provisioning`,
		)
		await deleteState(r2, vpsName)
		return freshProvision(config, r2, vpsName)
	}

	if (state.phase === 'created') {
		return resumeFromCreated(context, state, etag)
	}

	const label = state.phase === 'provisioned' ? 'Resuming from' : 'Re-running'
	logger.info(
		`${label} phase=${state.phase} for VPS "${vpsName}" (server ${state.serverId})`,
	)

	return executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => ({
			handled: false,
			detail: `existing #${String(state.serverId)}`,
		}),
		firewall: () => ({ handled: false, detail: 'existing' }),
		tailscale: () => ({
			handled: false,
			detail: `existing (${state.tailnetIp})`,
		}),
		certs: () => CERTS_PROVISION_OUTCOME,
		dns: () => DNS_PROVISION_OUTCOME,
		state: () =>
			convergeAndWriteState(
				context,
				{
					serverId: state.serverId,
					publicIp: state.publicIp,
					tailnetIp: state.tailnetIp,
					sshHostKeyFingerprint: state.sshHostKeyFingerprint,
					hostPorts: state.hostPorts,
				},
				etag,
			),
	})
}

async function resumeFromCreated(
	context: VpsProvisionContext,
	state: HcloudVpsState & { phase: 'created' },
	etag: string,
): Promise<VpsResourceOutcome> {
	logger.info(
		`Resuming from phase=created for VPS "${context.vpsName}" (server ${state.serverId})`,
	)
	return provisionFromCreated(context, {
		serverId: state.serverId,
		publicIp: state.publicIp,
		hostPorts: state.hostPorts,
		serverOutcome: {
			handled: false,
			detail: `existing #${String(state.serverId)}`,
		},
		createdEtag: etag,
		vpsLabel: 'VPS',
	})
}

async function attachToExistingVps(
	config: HetznerVpsTargetConfig,
	r2: ObjectStoreClient,
	vpsName: string,
	server: ExistingVpsRef,
): Promise<VpsResourceOutcome> {
	const createdEtag = await writeState(r2, vpsName, {
		phase: 'created',
		serverId: server.serverId,
		publicIp: server.publicIp,
		hostPorts: {},
	})
	logger.info(
		`State seeded: phase=created for attached VPS "${vpsName}" (server ${server.serverId})`,
	)
	return provisionFromCreated(
		{ config, r2, vpsName },
		{
			serverId: server.serverId,
			publicIp: server.publicIp,
			hostPorts: {},
			serverOutcome: {
				handled: false,
				detail: `attached #${String(server.serverId)}`,
			},
			createdEtag,
			vpsLabel: 'attached VPS',
		},
	)
}
