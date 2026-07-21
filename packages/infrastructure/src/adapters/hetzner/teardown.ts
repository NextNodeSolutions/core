import { extractUpstreams } from '#/domain/caddy/config.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { executeHandlers } from '#/domain/deploy/execute-handlers.ts'
import {
	VPS_MANAGED_RESOURCES,
	VPS_PROJECT_MANAGED_RESOURCES,
} from '#/domain/hetzner/managed-resources.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'
import { createSshSession } from './ssh/session.ts'
import { readState } from './state/read-write.ts'
import {
	releaseProjectHostPort,
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

import type { UserServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { TeardownResult } from '#/domain/deploy/teardown-result.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { DnsClient } from '#/domain/dns/client.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import type { TailnetClient } from '#/domain/tailnet/client.ts'
import type { SshSession } from './ssh/session.types.ts'
import type { HcloudConvergedState } from './state/types.ts'

const logger = createLogger()

export interface HetznerTeardownContext {
	readonly projectName: string
	readonly vpsName: string
	readonly domain: string | undefined
	// Declared deploy services - project teardown derives the routed hostnames
	// to delete (DNS, certs, Caddy route) from each service's `url`, the same set
	// deploy created, rather than the bare project domain.
	readonly services: Readonly<Record<string, UserServiceConfig>>
	readonly target: TeardownTarget
	readonly shouldWipeVolumes: boolean
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
			`VPS "${ctx.vpsName}" state phase is "${existing.state.phase}" - skipping Caddy upstream enumeration; only the project's own DNS (${ctx.domain ?? 'none'}) will be cleaned`,
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
				`No Caddy config on VPS "${ctx.vpsName}" - no project hostnames to enumerate`,
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

	const convergedState: HcloudConvergedState = existing.state
	const session = await createSshSession({
		host: convergedState.tailnetIp,
		username: 'deploy',
		privateKey: ctx.deployPrivateKey,
		expectedHostKeyFingerprint: convergedState.sshHostKeyFingerprint,
	})

	try {
		return await teardownProjectWithSession(
			ctx,
			session,
			{ state: convergedState, etag: existing.etag },
			start,
		)
	} finally {
		session.close()
	}
}

async function teardownProjectWithSession(
	ctx: HetznerTeardownContext,
	session: SshSession,
	existing: { state: HcloudConvergedState; etag: string },
	startMs: number,
): Promise<TeardownResult> {
	// The hostnames this project routes - one per service that declares a `url`,
	// resolved per environment, exactly the set deploy created (Caddy upstreams,
	// cert subjects, DNS records). Deleting from this set keeps teardown
	// symmetric with deploy; a url-less project routes nothing and gets none.
	const projectHostnames = Object.values(ctx.services).flatMap(service =>
		typeof service.url === 'undefined'
			? []
			: [resolveDeployDomain(service.url, ctx.environment)],
	)

	const outcome = await executeHandlers(VPS_PROJECT_MANAGED_RESOURCES, {
		container: () =>
			teardownProjectContainer(
				session,
				ctx.projectName,
				ctx.environment,
				ctx.shouldWipeVolumes,
			),
		caddy: () =>
			teardownProjectCaddyRoute(session, projectHostnames, {
				vpsName: ctx.vpsName,
				infraStorage: ctx.infraStorage,
				acmeEmail: ctx.acmeEmail,
				internal: ctx.internal,
			}),
		certs: () =>
			teardownProjectCerts(ctx.certsR2, ctx.vpsName, projectHostnames),
		dns: () => teardownProjectDns(projectHostnames, ctx.dns),
		state: () =>
			releaseProjectHostPort(ctx.projectName, {
				r2: ctx.r2,
				vpsName: ctx.vpsName,
				state: existing.state,
				etag: existing.etag,
			}),
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
