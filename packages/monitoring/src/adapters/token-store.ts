import { randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { Tenant, TenantTier } from '../domain/tenant.ts'
import { isTenantTier, rateLimitForTier } from '../domain/tenant.ts'
import { formatToken, TOKEN_RANDOM_BYTES } from '../domain/token.ts'

export interface CreateInput {
	readonly clientId: string
	readonly project: string
	readonly tier: TenantTier
}

export interface CreateResult {
	readonly tenant: Tenant
	readonly plaintext: string
}

export interface ListOptions {
	readonly includeRevoked?: boolean
}

export interface TokenStore {
	create(input: CreateInput): CreateResult
	findByHash(hash: string): Tenant | null
	findById(id: string): Tenant | null
	list(options?: ListOptions): ReadonlyArray<Tenant>
	revoke(id: string): boolean
	rotate(id: string): CreateResult
	close(): void
}

const SCHEMA_SQL = `
	CREATE TABLE IF NOT EXISTS tenants (
		id TEXT PRIMARY KEY,
		client_id TEXT NOT NULL,
		project TEXT NOT NULL,
		tier TEXT NOT NULL,
		rate_limit_rpm INTEGER NOT NULL,
		token_hash TEXT NOT NULL UNIQUE,
		created_at TEXT NOT NULL,
		revoked_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_tenants_token_hash ON tenants(token_hash);
	CREATE INDEX IF NOT EXISTS idx_tenants_client_project ON tenants(client_id, project);
`

const SELECT_COLUMNS =
	'id, client_id, project, tier, rate_limit_rpm, token_hash, created_at, revoked_at'

interface TenantRow {
	readonly id: string
	readonly client_id: string
	readonly project: string
	readonly tier: string
	readonly rate_limit_rpm: number
	readonly token_hash: string
	readonly created_at: string
	readonly revoked_at: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTenantRow(value: unknown): value is TenantRow {
	if (!isRecord(value)) return false
	const revokedAt = value['revoked_at']
	return (
		typeof value['id'] === 'string' &&
		typeof value['client_id'] === 'string' &&
		typeof value['project'] === 'string' &&
		typeof value['tier'] === 'string' &&
		typeof value['rate_limit_rpm'] === 'number' &&
		typeof value['token_hash'] === 'string' &&
		typeof value['created_at'] === 'string' &&
		(revokedAt === null || typeof revokedAt === 'string')
	)
}

function parseTenantRow(value: unknown): Tenant {
	if (!isTenantRow(value)) {
		throw new Error(
			'token-store: SQLite row does not match TenantRow shape — database corrupted',
		)
	}
	if (!isTenantTier(value.tier)) {
		throw new Error(
			`tenant ${value.id} has unknown tier "${value.tier}" — database corrupted`,
		)
	}
	return {
		id: value.id,
		clientId: value.client_id,
		project: value.project,
		tier: value.tier,
		rateLimitRpm: value.rate_limit_rpm,
		createdAt: new Date(value.created_at),
		revokedAt:
			value.revoked_at === null ? null : new Date(value.revoked_at),
	}
}

export function openTokenStore(dbPath: string): TokenStore {
	const db = new DatabaseSync(dbPath)
	db.exec('PRAGMA journal_mode = WAL;')
	db.exec('PRAGMA foreign_keys = ON;')
	db.exec(SCHEMA_SQL)

	const insertStmt = db.prepare(
		`INSERT INTO tenants (id, client_id, project, tier, rate_limit_rpm, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
	const findByHashStmt = db.prepare(
		`SELECT ${SELECT_COLUMNS} FROM tenants WHERE token_hash = ? AND revoked_at IS NULL`,
	)
	const findByIdStmt = db.prepare(
		`SELECT ${SELECT_COLUMNS} FROM tenants WHERE id = ?`,
	)
	const listActiveStmt = db.prepare(
		`SELECT ${SELECT_COLUMNS} FROM tenants WHERE revoked_at IS NULL ORDER BY created_at ASC`,
	)
	const listAllStmt = db.prepare(
		`SELECT ${SELECT_COLUMNS} FROM tenants ORDER BY created_at ASC`,
	)
	const revokeStmt = db.prepare(
		`UPDATE tenants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
	)

	function transaction<T>(fn: () => T): T {
		db.exec('BEGIN IMMEDIATE')
		try {
			const result = fn()
			db.exec('COMMIT')
			return result
		} catch (err) {
			// Meaningful recovery: undo partial writes before rethrowing so the
			// caller sees the original error and the DB stays consistent.
			db.exec('ROLLBACK')
			throw err
		}
	}

	function insertTenant(input: CreateInput): CreateResult {
		const id = randomUUID()
		const token = formatToken(randomBytes(TOKEN_RANDOM_BYTES))
		const rateLimit = rateLimitForTier(input.tier)
		const createdAt = new Date()

		insertStmt.run(
			id,
			input.clientId,
			input.project,
			input.tier,
			rateLimit,
			token.hash,
			createdAt.toISOString(),
		)

		return {
			tenant: {
				id,
				clientId: input.clientId,
				project: input.project,
				tier: input.tier,
				rateLimitRpm: rateLimit,
				createdAt,
				revokedAt: null,
			},
			plaintext: token.plaintext,
		}
	}

	function create(input: CreateInput): CreateResult {
		return insertTenant(input)
	}

	function findByHash(hash: string): Tenant | null {
		const row: unknown = findByHashStmt.get(hash)
		return row === undefined ? null : parseTenantRow(row)
	}

	function findById(id: string): Tenant | null {
		const row: unknown = findByIdStmt.get(id)
		return row === undefined ? null : parseTenantRow(row)
	}

	function list(options: ListOptions = {}): ReadonlyArray<Tenant> {
		const stmt = options.includeRevoked ? listAllStmt : listActiveStmt
		const rows: ReadonlyArray<unknown> = stmt.all()
		return rows.map(parseTenantRow)
	}

	function revoke(id: string): boolean {
		const result = revokeStmt.run(new Date().toISOString(), id)
		return Number(result.changes) > 0
	}

	function rotate(id: string): CreateResult {
		const existing = findById(id)
		if (existing === null) {
			throw new Error(`tenant ${id} not found — cannot rotate`)
		}
		if (existing.revokedAt !== null) {
			throw new Error(`tenant ${id} already revoked — cannot rotate`)
		}

		return transaction(() => {
			revokeStmt.run(new Date().toISOString(), id)
			return insertTenant({
				clientId: existing.clientId,
				project: existing.project,
				tier: existing.tier,
			})
		})
	}

	function close(): void {
		db.close()
	}

	return { create, findByHash, findById, list, revoke, rotate, close }
}
