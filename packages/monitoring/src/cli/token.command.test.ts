import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openTokenStore } from '../adapters/token-store.ts'
import { hashToken } from '../domain/token.ts'

import { tokenCommand } from './token.command.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonLine(line: string | undefined): Record<string, unknown> {
	if (line === undefined) {
		expect.unreachable('expected output line to be defined')
	}
	const parsed: unknown = JSON.parse(line)
	if (!isRecord(parsed)) {
		expect.unreachable(`expected JSON object, got: ${line}`)
	}
	return parsed
}

function readString(record: Record<string, unknown>, key: string): string {
	const value = record[key]
	if (typeof value !== 'string') {
		expect.unreachable(
			`expected "${key}" to be a string, got: ${String(value)}`,
		)
	}
	return value
}

describe('tokenCommand', () => {
	let tempDir: string
	let dbPath: string
	let output: string[]
	const write = (line: string): void => {
		output.push(line)
	}

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'nn-monitor-cli-'))
		dbPath = join(tempDir, 'tokens.db')
		output = []
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	interface CreatedTenant {
		readonly id: string
		readonly token: string
	}

	function parseCreateOutput(): CreatedTenant {
		expect(output).toHaveLength(1)
		const parsed = parseJsonLine(output[0])
		return {
			id: readString(parsed, 'id'),
			token: readString(parsed, 'token'),
		}
	}

	describe('create', () => {
		it('creates a tenant and prints a parseable JSON line with the plaintext', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'shop'], {
				dbPath,
				write,
			})

			expect(output).toHaveLength(1)
			const payload = parseJsonLine(output[0])
			expect(payload['action']).toBe('create')
			expect(payload['clientId']).toBe('acme')
			expect(payload['project']).toBe('shop')
			expect(payload['tier']).toBe('standard')
			expect(payload['rateLimitRpm']).toBe(60)
			expect(readString(payload, 'token')).toMatch(/^nn_live_/)
		})

		it('persists the token so a subsequent list finds it', () => {
			tokenCommand(
				[
					'create',
					'--client',
					'acme',
					'--project',
					'api',
					'--tier',
					'enterprise',
				],
				{ dbPath, write },
			)
			const created = parseCreateOutput()
			output = []

			tokenCommand(['list'], { dbPath, write })

			expect(output).toHaveLength(1)
			const listed = parseJsonLine(output[0])
			expect(listed['id']).toBe(created.id)
			expect(listed['tier']).toBe('enterprise')
			expect(listed['rateLimitRpm']).toBe(600)
		})

		it('stores the hash so findByHash can recover the tenant from the plaintext', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'api'], {
				dbPath,
				write,
			})
			const created = parseCreateOutput()

			const store = openTokenStore(dbPath)
			const recovered = store.findByHash(hashToken(created.token))
			store.close()

			expect(recovered?.id).toBe(created.id)
		})

		it('throws when --client is missing', () => {
			expect(() =>
				tokenCommand(['create', '--project', 'api'], { dbPath, write }),
			).toThrow('token create: --client is required')
		})

		it('throws when --project is missing', () => {
			expect(() =>
				tokenCommand(['create', '--client', 'acme'], { dbPath, write }),
			).toThrow('token create: --project is required')
		})

		it('throws when --tier is not a known tier', () => {
			expect(() =>
				tokenCommand(
					[
						'create',
						'--client',
						'acme',
						'--project',
						'api',
						'--tier',
						'premium',
					],
					{ dbPath, write },
				),
			).toThrow(
				'token create: --tier must be one of: standard, enterprise (got: premium)',
			)
		})
	})

	describe('list', () => {
		it('prints nothing when no tenants exist', () => {
			tokenCommand(['list'], { dbPath, write })

			expect(output).toEqual([])
		})

		it('prints only active tenants by default', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'api'], {
				dbPath,
				write,
			})
			const first = parseCreateOutput()
			output = []
			tokenCommand(['create', '--client', 'globex', '--project', 'web'], {
				dbPath,
				write,
			})
			output = []
			tokenCommand(['revoke', '--id', first.id], { dbPath, write })
			output = []

			tokenCommand(['list'], { dbPath, write })

			expect(output).toHaveLength(1)
			const listed = parseJsonLine(output[0])
			expect(listed['clientId']).toBe('globex')
		})

		it('includes revoked tenants with --all', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'api'], {
				dbPath,
				write,
			})
			const first = parseCreateOutput()
			output = []
			tokenCommand(['revoke', '--id', first.id], { dbPath, write })
			output = []

			tokenCommand(['list', '--all'], { dbPath, write })

			expect(output).toHaveLength(1)
			const listed = parseJsonLine(output[0])
			expect(listed['clientId']).toBe('acme')
			expect(listed['revokedAt']).not.toBeNull()
		})
	})

	describe('revoke', () => {
		it('marks the tenant revoked and prints a confirmation', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'api'], {
				dbPath,
				write,
			})
			const created = parseCreateOutput()
			output = []

			tokenCommand(['revoke', '--id', created.id], { dbPath, write })

			expect(output).toHaveLength(1)
			const payload = parseJsonLine(output[0])
			expect(payload['action']).toBe('revoke')
			expect(payload['tenantId']).toBe(created.id)
		})

		it('throws when --id is missing', () => {
			expect(() => tokenCommand(['revoke'], { dbPath, write })).toThrow(
				'token revoke: --id is required',
			)
		})

		it('throws when the tenant does not exist', () => {
			expect(() =>
				tokenCommand(['revoke', '--id', 'missing'], { dbPath, write }),
			).toThrow(
				'token revoke: tenant missing not found or already revoked',
			)
		})

		it('throws when revoking an already-revoked tenant', () => {
			tokenCommand(['create', '--client', 'acme', '--project', 'api'], {
				dbPath,
				write,
			})
			const created = parseCreateOutput()
			output = []
			tokenCommand(['revoke', '--id', created.id], { dbPath, write })
			output = []

			expect(() =>
				tokenCommand(['revoke', '--id', created.id], { dbPath, write }),
			).toThrow(
				`token revoke: tenant ${created.id} not found or already revoked`,
			)
		})
	})

	describe('rotate', () => {
		it('revokes the old tenant, creates a new one, and prints the new plaintext', () => {
			tokenCommand(
				[
					'create',
					'--client',
					'acme',
					'--project',
					'api',
					'--tier',
					'enterprise',
				],
				{ dbPath, write },
			)
			const original = parseCreateOutput()
			output = []

			tokenCommand(['rotate', '--id', original.id], { dbPath, write })

			expect(output).toHaveLength(1)
			const payload = parseJsonLine(output[0])
			expect(payload['action']).toBe('rotate')
			expect(payload['oldTenantId']).toBe(original.id)
			expect(payload['id']).not.toBe(original.id)
			expect(payload['clientId']).toBe('acme')
			expect(payload['tier']).toBe('enterprise')
			const newToken = readString(payload, 'token')
			expect(newToken).toMatch(/^nn_live_/)
			expect(newToken).not.toBe(original.token)
		})

		it('throws when --id is missing', () => {
			expect(() => tokenCommand(['rotate'], { dbPath, write })).toThrow(
				'token rotate: --id is required',
			)
		})

		it('throws when the tenant does not exist', () => {
			expect(() =>
				tokenCommand(['rotate', '--id', 'missing'], { dbPath, write }),
			).toThrow('tenant missing not found — cannot rotate')
		})
	})

	describe('dispatch', () => {
		it('throws for an unknown subcommand', () => {
			expect(() => tokenCommand(['delete'], { dbPath, write })).toThrow(
				'Unknown token subcommand: delete. Available: create, list, revoke, rotate',
			)
		})

		it('throws when no subcommand is passed', () => {
			expect(() => tokenCommand([], { dbPath, write })).toThrow(
				'token command requires a subcommand: create, list, revoke, rotate',
			)
		})
	})
})
