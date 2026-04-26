import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { DnsClient } from '#/domain/dns/client.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import { extractUpstreams } from '#/domain/hetzner/caddy-config.ts'
import {
	VPS_MANAGED_RESOURCES,
	VPS_PROJECT_MANAGED_RESOURCES,
} from '#/domain/hetzner/managed-resources.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import type { TailnetClient } from '#/domain/tailnet/client.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { createSshSession } from './ssh/session.ts'
import type { SshSession } from './ssh/session.types.ts'
import { readState } from './state/read-write.ts'
import {
	teardownProjectCaddyRoute,
	teardownProjectCerts,
	teardownProjectContainer,
	teardownProjectDns,
} from './teardown-project.ts'
import {
	teardownFirewall,
	teardownServer,
	teardownTailscale,
	teardownVpsCerts,
	teardownVpsDns,
	teardownVpsState,
} from './teardown-vps.ts'

const logger = createLogger()

export interface HetznerTeardownContext {
	readonly projectName: string
	readonly vpsName: string
	readonly domain: string | undefined
	readonly target: TeardownTarget
	readonly environment: AppEnvironment
	readonly internal: boolean
	readonly hcloudToken: string
	readonly tailnet: TailnetClient
	readonly deployPrivateKey: string
	readonly dns: DnsClient
	readonly r2: ObjectStoreClient
	readonly certsR2: ObjectStoreClient
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly acmeEmail: string
}

export async function runHetznerTeardown(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	if (ctx.target === 'vps') {
		return teardownVps(ctx)
	}
	return teardownProject(ctx)
}

async function teardownVps(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	const start = Date.now()

	const existing = await readState(ctx.r2, ctx.vpsName)
	if (!existing) {
		throw new Error(
			`Cannot teardown VPS "${ctx.vpsName}": no R2 state found. State is required to enumerate the VPS's projects (Caddy upstreams) and clean up DNS for all of them. If the VPS truly has no state, manual cleanup is required.`,
		)
	}

	const hostnames =
		existing.state.phase === 'converged'
			? await readCaddyHostnames(
					ctx,
					existing.state.tailnetIp,
					existing.state.sshHostKeyFingerprint,
				)
			: []

	if (existing.state.phase !== 'converged') {
		logger.warn(
			`VPS "${ctx.vpsName}" state phase is "${existing.state.phase}" — skipping Caddy upstream enumeration; only the project's own DNS (${ctx.domain ?? 'none'}) will be cleaned`,
		)
	}

	const dnsHostnames = mergeHostnames(
		hostnames,
		ctx.domain
			? resolveDeployDomain(ctx.domain, ctx.environment)
			: undefined,
	)

	const outcome = await executeHandlers(VPS_MANAGED_RESOURCES, {
		server: () => teardownServer(ctx.hcloudToken, ctx.r2, ctx.vpsName),
		firewall: () => teardownFirewall(ctx.hcloudToken, ctx.vpsName),
		tailscale: () => teardownTailscale(ctx.tailnet, ctx.vpsName),
		certs: () => teardownVpsCerts(ctx.certsR2, ctx.vpsName),
		dns: () => teardownVpsDns(dnsHostnames, ctx.dns),
		state: () => teardownVpsState(ctx.r2, ctx.vpsName),
	})

	logger.info(`VPS teardown complete for "${ctx.vpsName}"`)

	return {
		kind: 'vps',
		scope: 'vps',
		outcome,
		durationMs: Date.now() - start,
	}
}

async function readCaddyHostnames(
	ctx: HetznerTeardownContext,
	tailnetIp: string,
	expectedFingerprint: string | undefined,
): Promise<ReadonlyArray<string>> {
	const session = await createSshSession({
		host: tailnetIp,
		username: 'deploy',
		privateKey: ctx.deployPrivateKey,
		expectedHostKeyFingerprint: expectedFingerprint,
	})
	try {
		const config = await session.readFile(CADDY_CONFIG_PATH)
		if (config === null) {
			logger.info(
				`No Caddy config on VPS "${ctx.vpsName}" — no project hostnames to enumerate`,
			)
			return []
		}
		const upstreams = extractUpstreams(config)
		const hostnames = upstreams.map(u => u.hostname)
		logger.info(
			`Enumerated ${String(hostnames.length)} project hostname(s) on VPS "${ctx.vpsName}": ${hostnames.join(', ')}`,
		)
		return hostnames
	} finally {
		session.close()
	}
}

function mergeHostnames(
	enumerated: ReadonlyArray<string>,
	fallback: string | undefined,
): ReadonlyArray<string> {
	const set = new Set(enumerated)
	if (fallback) set.add(fallback)
	return [...set]
}

async function teardownProject(
	ctx: HetznerTeardownContext,
): Promise<TeardownResult> {
	const start = Date.now()

	const existing = await readState(ctx.r2, ctx.vpsName)
	if (!existing) {
		throw new Error(
			`Cannot teardown project "${ctx.projectName}" on VPS "${ctx.vpsName}": no R2 state found. The VPS must be provisioned and converged before a project can be torn down. Run a VPS-scoped teardown if the VPS itself should be removed.`,
		)
	}
	if (existing.state.phase !== 'converged') {
		throw new Error(
			`Cannot teardown project "${ctx.projectName}" on VPS "${ctx.vpsName}": state phase is "${existing.state.phase}", expected "converged". The VPS infrastructure is not in a deployable state, so the project cannot have been deployed.`,
		)
	}

	const session = await createSshSession({
		host: existing.state.tailnetIp,
		username: 'deploy',
		privateKey: ctx.deployPrivateKey,
		expectedHostKeyFingerprint: existing.state.sshHostKeyFingerprint,
	})

	try {
		return await teardownProjectWithSession(ctx, session, start)
	} finally {
		session.close()
	}
}

async function teardownProjectWithSession(
	ctx: HetznerTeardownContext,
	session: SshSession,
	startMs: number,
): Promise<TeardownResult> {
	const projectHostname = ctx.domain
		? resolveDeployDomain(ctx.domain, ctx.environment)
		: undefined

	const outcome = await executeHandlers(VPS_PROJECT_MANAGED_RESOURCES, {
		container: () =>
			teardownProjectContainer(session, ctx.projectName, ctx.environment),
		caddy: () =>
			teardownProjectCaddyRoute(session, projectHostname, {
				vpsName: ctx.vpsName,
				infraStorage: ctx.infraStorage,
				acmeEmail: ctx.acmeEmail,
				internal: ctx.internal,
			}),
		certs: () =>
			teardownProjectCerts(ctx.certsR2, ctx.vpsName, projectHostname),
		dns: () => teardownProjectDns(projectHostname, ctx.dns),
		state: () => skipSharedState(),
	})

	logger.info(
		`Project teardown complete for "${ctx.projectName}" on VPS "${ctx.vpsName}"`,
	)

	return {
		kind: 'vps',
		scope: 'project',
		outcome,
		durationMs: Date.now() - startMs,
	}
}

// State is keyed by VPS name and shared across every project on the same
// VPS. Per-project teardown leaves the state intact.
function skipSharedState(): ResourceOutcome {
	return { handled: false, detail: 'shared with VPS — kept' }
}
