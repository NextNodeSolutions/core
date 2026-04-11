import { parseArgs } from 'node:util'

import type { TokenStore } from '../adapters/token-store.ts'
import { openTokenStore } from '../adapters/token-store.ts'
import type { Tenant } from '../domain/tenant.ts'
import { isTenantTier } from '../domain/tenant.ts'

import { requireEnv } from './env.ts'

const MONITORING_DB_PATH_ENV = 'MONITORING_DB_PATH'

type Writer = (line: string) => void
type StoreFactory = (dbPath: string) => TokenStore

export interface TokenCommandOptions {
	readonly openStore?: StoreFactory
	readonly write?: Writer
	readonly dbPath?: string
}

export function tokenCommand(
	args: readonly string[],
	options: TokenCommandOptions = {},
): void {
	const [subcommand, ...rest] = args
	if (subcommand === undefined) {
		throw new Error(
			'token command requires a subcommand: create, list, revoke, rotate',
		)
	}

	const write = options.write ?? defaultWrite
	const dbPath = options.dbPath ?? requireEnv(MONITORING_DB_PATH_ENV)
	const openStore = options.openStore ?? openTokenStore
	const store = openStore(dbPath)

	try {
		dispatch(subcommand, store, rest, write)
	} finally {
		store.close()
	}
}

function dispatch(
	subcommand: string,
	store: TokenStore,
	args: readonly string[],
	write: Writer,
): void {
	switch (subcommand) {
		case 'create':
			runCreate(store, args, write)
			return
		case 'list':
			runList(store, args, write)
			return
		case 'revoke':
			runRevoke(store, args, write)
			return
		case 'rotate':
			runRotate(store, args, write)
			return
		default:
			throw new Error(
				`Unknown token subcommand: ${subcommand}. Available: create, list, revoke, rotate`,
			)
	}
}

function defaultWrite(line: string): void {
	// CLI user-facing output: stdout is the one channel through which the
	// operator sees a generated token. Logger is reserved for observability.
	process.stdout.write(`${line}\n`)
}

function tenantToPublicJson(tenant: Tenant): Record<string, unknown> {
	return {
		id: tenant.id,
		clientId: tenant.clientId,
		project: tenant.project,
		tier: tenant.tier,
		rateLimitRpm: tenant.rateLimitRpm,
		createdAt: tenant.createdAt.toISOString(),
		revokedAt:
			tenant.revokedAt === null ? null : tenant.revokedAt.toISOString(),
	}
}

function runCreate(
	store: TokenStore,
	args: readonly string[],
	write: Writer,
): void {
	const { values } = parseArgs({
		args: [...args],
		options: {
			client: { type: 'string', short: 'c' },
			project: { type: 'string', short: 'p' },
			tier: { type: 'string', short: 't', default: 'standard' },
		},
		strict: true,
	})

	const client = values.client
	const project = values.project
	const tier = values.tier ?? 'standard'

	if (typeof client !== 'string' || client.length === 0) {
		throw new Error('token create: --client is required')
	}
	if (typeof project !== 'string' || project.length === 0) {
		throw new Error('token create: --project is required')
	}
	if (!isTenantTier(tier)) {
		throw new Error(
			`token create: --tier must be one of: standard, enterprise (got: ${tier})`,
		)
	}

	const result = store.create({ clientId: client, project, tier })
	write(
		JSON.stringify({
			action: 'create',
			...tenantToPublicJson(result.tenant),
			token: result.plaintext,
		}),
	)
}

function runList(
	store: TokenStore,
	args: readonly string[],
	write: Writer,
): void {
	const { values } = parseArgs({
		args: [...args],
		options: {
			all: { type: 'boolean', default: false },
		},
		strict: true,
	})

	const tenants = store.list({ includeRevoked: values.all ?? false })
	for (const tenant of tenants) {
		write(JSON.stringify(tenantToPublicJson(tenant)))
	}
}

function runRevoke(
	store: TokenStore,
	args: readonly string[],
	write: Writer,
): void {
	const { values } = parseArgs({
		args: [...args],
		options: {
			id: { type: 'string' },
		},
		strict: true,
	})

	const id = values.id
	if (typeof id !== 'string' || id.length === 0) {
		throw new Error('token revoke: --id is required')
	}

	const success = store.revoke(id)
	if (!success) {
		throw new Error(
			`token revoke: tenant ${id} not found or already revoked`,
		)
	}

	write(JSON.stringify({ action: 'revoke', tenantId: id }))
}

function runRotate(
	store: TokenStore,
	args: readonly string[],
	write: Writer,
): void {
	const { values } = parseArgs({
		args: [...args],
		options: {
			id: { type: 'string' },
		},
		strict: true,
	})

	const id = values.id
	if (typeof id !== 'string' || id.length === 0) {
		throw new Error('token rotate: --id is required')
	}

	const result = store.rotate(id)
	write(
		JSON.stringify({
			action: 'rotate',
			oldTenantId: id,
			...tenantToPublicJson(result.tenant),
			token: result.plaintext,
		}),
	)
}
