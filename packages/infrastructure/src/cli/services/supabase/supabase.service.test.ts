import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import type { OrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	createSupabaseService,
	ensureJwtSecret,
	ensurePgExporterPasswordSecret,
	ensurePostgresPasswordSecret,
	generateJwtSecret,
	generatePgExporterPassword,
	generatePostgresPassword,
	requireDashboardPasswordSecret,
	rotatePgExporterPasswordSecret,
	supabaseServiceDefinition,
} from './supabase.service.ts'

function makeCtx(
	repoSecrets: Readonly<Record<string, string>> = {},
	projectName = 'myapp',
): ServiceFactoryContext {
	return {
		projectName,
		environment: 'production',
		repository: { owner: 'NextNodeSolutions', name: 'core' },
		cfToken: 'cf-token',
		infraStorage: null,
		repoSecrets,
	}
}

function makeAdapter(
	overrides: Partial<OrgSecretsAdapter> = {},
): OrgSecretsAdapter {
	return {
		ghAvailable: vi.fn().mockResolvedValue(true),
		setOrgSecret: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function makeEnvAdapter(
	overrides: Partial<EnvSecretsAdapter> = {},
): EnvSecretsAdapter {
	return {
		ghAvailable: vi.fn().mockResolvedValue(true),
		setRepoEnvSecret: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

beforeEach(() => {
	vi.stubEnv('GITHUB_REPOSITORY_OWNER', 'NextNodeOrg')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('generatePgExporterPassword', () => {
	it('returns a 32-byte secret base64-encoded (44 chars including padding)', () => {
		const password = generatePgExporterPassword()
		expect(password).toHaveLength(44)
		expect(password).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
		expect(Buffer.from(password, 'base64')).toHaveLength(32)
	})

	it('produces a different value on each call', () => {
		expect(generatePgExporterPassword()).not.toBe(
			generatePgExporterPassword(),
		)
	})
})

describe('ensurePgExporterPasswordSecret', () => {
	it('skips when the secret is already in ALL_SECRETS (no gh call)', async () => {
		const adapter = makeAdapter()

		await ensurePgExporterPasswordSecret(
			'myapp',
			{ PG_EXPORTER_PASSWORD_MYAPP: 'existing' },
			adapter,
		)

		expect(adapter.ghAvailable).not.toHaveBeenCalled()
		expect(adapter.setOrgSecret).not.toHaveBeenCalled()
	})

	it('generates + persists a fresh 32-byte b64 password when absent from ALL_SECRETS', async () => {
		const adapter = makeAdapter()

		await ensurePgExporterPasswordSecret('my-cool-app', {}, adapter)

		expect(adapter.setOrgSecret).toHaveBeenCalledTimes(1)
		const [name, value, org] = vi.mocked(adapter.setOrgSecret).mock
			.calls[0]!
		expect(name).toBe('PG_EXPORTER_PASSWORD_MY_COOL_APP')
		expect(org).toBe('NextNodeOrg')
		expect(value).toHaveLength(44)
		expect(Buffer.from(value, 'base64')).toHaveLength(32)
	})

	it('throws when GITHUB_REPOSITORY_OWNER is unset', async () => {
		vi.unstubAllEnvs()

		await expect(
			ensurePgExporterPasswordSecret('myapp', {}, makeAdapter()),
		).rejects.toThrow(/GITHUB_REPOSITORY_OWNER/)
	})

	it('throws when gh CLI is unavailable rather than silently dropping the password', async () => {
		const adapter = makeAdapter({
			ghAvailable: vi.fn().mockResolvedValue(false),
		})

		await expect(
			ensurePgExporterPasswordSecret('myapp', {}, adapter),
		).rejects.toThrow(/gh CLI unavailable/)
		expect(adapter.setOrgSecret).not.toHaveBeenCalled()
	})
})

describe('generatePostgresPassword', () => {
	it('returns a 32-byte secret base64-encoded (44 chars including padding)', () => {
		const password = generatePostgresPassword()
		expect(password).toHaveLength(44)
		expect(password).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
		expect(Buffer.from(password, 'base64')).toHaveLength(32)
	})

	it('produces a different value on each call', () => {
		expect(generatePostgresPassword()).not.toBe(generatePostgresPassword())
	})
})

describe('ensurePostgresPasswordSecret', () => {
	it('skips when POSTGRES_PASSWORD is already in ALL_SECRETS (no gh call)', async () => {
		const adapter = makeEnvAdapter()

		await ensurePostgresPasswordSecret(
			{ POSTGRES_PASSWORD: 'existing' },
			'NextNodeSolutions',
			'core',
			'production',
			adapter,
		)

		expect(adapter.ghAvailable).not.toHaveBeenCalled()
		expect(adapter.setRepoEnvSecret).not.toHaveBeenCalled()
	})

	it('persists a fresh 32-byte b64 password as an env-secret (repo + env scope, no project suffix)', async () => {
		const adapter = makeEnvAdapter()

		await ensurePostgresPasswordSecret(
			{},
			'NextNodeSolutions',
			'core',
			'production',
			adapter,
		)

		expect(adapter.setRepoEnvSecret).toHaveBeenCalledTimes(1)
		const [name, value, owner, repo, environment] = vi.mocked(
			adapter.setRepoEnvSecret,
		).mock.calls[0]!
		expect(name).toBe('POSTGRES_PASSWORD')
		expect(owner).toBe('NextNodeSolutions')
		expect(repo).toBe('core')
		expect(environment).toBe('production')
		expect(value).toHaveLength(44)
		expect(Buffer.from(value, 'base64')).toHaveLength(32)
	})

	it('scopes to the development environment when called from a dev deploy', async () => {
		const adapter = makeEnvAdapter()

		await ensurePostgresPasswordSecret(
			{},
			'NextNodeSolutions',
			'core',
			'development',
			adapter,
		)

		const [, , , , environment] = vi.mocked(adapter.setRepoEnvSecret).mock
			.calls[0]!
		expect(environment).toBe('development')
	})

	it('throws when gh CLI is unavailable rather than silently dropping the password', async () => {
		const adapter = makeEnvAdapter({
			ghAvailable: vi.fn().mockResolvedValue(false),
		})

		await expect(
			ensurePostgresPasswordSecret(
				{},
				'NextNodeSolutions',
				'core',
				'production',
				adapter,
			),
		).rejects.toThrow(/gh CLI unavailable/)
		expect(adapter.setRepoEnvSecret).not.toHaveBeenCalled()
	})
})

describe('generateJwtSecret', () => {
	it('returns a 32-byte secret base64-encoded (44 chars including padding)', () => {
		const secret = generateJwtSecret()
		expect(secret).toHaveLength(44)
		expect(secret).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
		expect(Buffer.from(secret, 'base64')).toHaveLength(32)
	})

	it('produces a different value on each call', () => {
		expect(generateJwtSecret()).not.toBe(generateJwtSecret())
	})
})

describe('ensureJwtSecret', () => {
	it('skips when JWT_SECRET is already in ALL_SECRETS (no gh call)', async () => {
		const adapter = makeEnvAdapter()

		await ensureJwtSecret(
			{ JWT_SECRET: 'existing' },
			'NextNodeSolutions',
			'core',
			'production',
			adapter,
		)

		expect(adapter.ghAvailable).not.toHaveBeenCalled()
		expect(adapter.setRepoEnvSecret).not.toHaveBeenCalled()
	})

	it('persists a fresh 32-byte b64 secret as an env-secret (repo + env scope, no project suffix)', async () => {
		const adapter = makeEnvAdapter()

		await ensureJwtSecret(
			{},
			'NextNodeSolutions',
			'core',
			'production',
			adapter,
		)

		expect(adapter.setRepoEnvSecret).toHaveBeenCalledTimes(1)
		const [name, value, owner, repo, environment] = vi.mocked(
			adapter.setRepoEnvSecret,
		).mock.calls[0]!
		expect(name).toBe('JWT_SECRET')
		expect(owner).toBe('NextNodeSolutions')
		expect(repo).toBe('core')
		expect(environment).toBe('production')
		expect(value).toHaveLength(44)
		expect(Buffer.from(value, 'base64')).toHaveLength(32)
	})

	it('scopes to the development environment when called from a dev deploy', async () => {
		const adapter = makeEnvAdapter()

		await ensureJwtSecret(
			{},
			'NextNodeSolutions',
			'core',
			'development',
			adapter,
		)

		const [, , , , environment] = vi.mocked(adapter.setRepoEnvSecret).mock
			.calls[0]!
		expect(environment).toBe('development')
	})

	it('throws when gh CLI is unavailable rather than silently dropping the secret', async () => {
		const adapter = makeEnvAdapter({
			ghAvailable: vi.fn().mockResolvedValue(false),
		})

		await expect(
			ensureJwtSecret(
				{},
				'NextNodeSolutions',
				'core',
				'production',
				adapter,
			),
		).rejects.toThrow(/gh CLI unavailable/)
		expect(adapter.setRepoEnvSecret).not.toHaveBeenCalled()
	})
})

describe('requireDashboardPasswordSecret', () => {
	it('returns silently when DASHBOARD_PASSWORD is present in ALL_SECRETS', () => {
		expect(() =>
			requireDashboardPasswordSecret(
				{ DASHBOARD_PASSWORD: 'operator-chosen' },
				'NextNodeSolutions',
				'core',
				'production',
			),
		).not.toThrow()
	})

	it('throws a helpful error pointing to the env-secret name and the gh command when absent', () => {
		expect(() =>
			requireDashboardPasswordSecret(
				{},
				'NextNodeSolutions',
				'core',
				'production',
			),
		).toThrow(
			/env-secret "DASHBOARD_PASSWORD" must be set on NextNodeSolutions\/core for the "production" environment.*gh secret set DASHBOARD_PASSWORD --repo NextNodeSolutions\/core --env production/s,
		)
	})

	it('scopes the error to the development environment when called from a dev deploy', () => {
		expect(() =>
			requireDashboardPasswordSecret(
				{},
				'NextNodeSolutions',
				'core',
				'development',
			),
		).toThrow(/"development"/)
	})
})

describe('rotatePgExporterPasswordSecret', () => {
	it('force-sets the secret with a fresh value (no idempotency check)', async () => {
		const adapter = makeAdapter()

		await rotatePgExporterPasswordSecret('myapp', adapter)

		expect(adapter.setOrgSecret).toHaveBeenCalledTimes(1)
		const [name, value, org] = vi.mocked(adapter.setOrgSecret).mock
			.calls[0]!
		expect(name).toBe('PG_EXPORTER_PASSWORD_MYAPP')
		expect(org).toBe('NextNodeOrg')
		expect(value).toHaveLength(44)
	})

	it('throws when gh CLI is unavailable', async () => {
		const adapter = makeAdapter({
			ghAvailable: vi.fn().mockResolvedValue(false),
		})

		await expect(
			rotatePgExporterPasswordSecret('myapp', adapter),
		).rejects.toThrow(/gh CLI unavailable/)
	})
})

describe('createSupabaseService', () => {
	it('exposes the service under the "supabase" name', () => {
		expect(createSupabaseService(makeCtx()).name).toBe('supabase')
	})

	describe('loadEnv', () => {
		const ALL_SECRETS = {
			PG_EXPORTER_PASSWORD_MYAPP: 'pgexp',
			POSTGRES_PASSWORD: 'pgpass',
			JWT_SECRET: 'jwt',
			DASHBOARD_PASSWORD: 'dash',
		} as const

		it('surfaces all four supabase secrets under their compose .env keys on the secret channel', async () => {
			const service = createSupabaseService(makeCtx(ALL_SECRETS))

			await expect(service.loadEnv()).resolves.toEqual({
				public: {},
				secret: {
					PG_EXPORTER_PASSWORD: 'pgexp',
					POSTGRES_PASSWORD: 'pgpass',
					JWT_SECRET: 'jwt',
					DASHBOARD_PASSWORD: 'dash',
				},
			})
		})

		it('reads the pg-exporter password under the project-derived name (kebab → snake-upper)', async () => {
			const service = createSupabaseService(
				makeCtx(
					{
						PG_EXPORTER_PASSWORD_MY_COOL_APP: 'pgexp',
						POSTGRES_PASSWORD: 'pgpass',
						JWT_SECRET: 'jwt',
						DASHBOARD_PASSWORD: 'dash',
					},
					'my-cool-app',
				),
			)

			const env = await service.loadEnv()
			expect(env.secret).toEqual({
				PG_EXPORTER_PASSWORD: 'pgexp',
				POSTGRES_PASSWORD: 'pgpass',
				JWT_SECRET: 'jwt',
				DASHBOARD_PASSWORD: 'dash',
			})
		})

		it('throws and lists every missing secret when none are present', async () => {
			const service = createSupabaseService(makeCtx({}))

			await expect(service.loadEnv()).rejects.toThrow(
				/PG_EXPORTER_PASSWORD_MYAPP.*POSTGRES_PASSWORD.*JWT_SECRET.*DASHBOARD_PASSWORD/s,
			)
		})

		it('throws and names PG_EXPORTER_PASSWORD_MYAPP when only the pg-exporter secret is missing', async () => {
			const service = createSupabaseService(
				makeCtx({
					POSTGRES_PASSWORD: 'pgpass',
					JWT_SECRET: 'jwt',
					DASHBOARD_PASSWORD: 'dash',
				}),
			)

			await expect(service.loadEnv()).rejects.toThrow(
				/PG_EXPORTER_PASSWORD_MYAPP/,
			)
		})

		it('throws and names POSTGRES_PASSWORD when only POSTGRES_PASSWORD is missing', async () => {
			const service = createSupabaseService(
				makeCtx({
					PG_EXPORTER_PASSWORD_MYAPP: 'pgexp',
					JWT_SECRET: 'jwt',
					DASHBOARD_PASSWORD: 'dash',
				}),
			)

			await expect(service.loadEnv()).rejects.toThrow(/POSTGRES_PASSWORD/)
		})

		it('throws and names JWT_SECRET when only JWT_SECRET is missing', async () => {
			const service = createSupabaseService(
				makeCtx({
					PG_EXPORTER_PASSWORD_MYAPP: 'pgexp',
					POSTGRES_PASSWORD: 'pgpass',
					DASHBOARD_PASSWORD: 'dash',
				}),
			)

			await expect(service.loadEnv()).rejects.toThrow(/JWT_SECRET/)
		})

		it('throws and names DASHBOARD_PASSWORD when only DASHBOARD_PASSWORD is missing', async () => {
			const service = createSupabaseService(
				makeCtx({
					PG_EXPORTER_PASSWORD_MYAPP: 'pgexp',
					POSTGRES_PASSWORD: 'pgpass',
					JWT_SECRET: 'jwt',
				}),
			)

			await expect(service.loadEnv()).rejects.toThrow(
				/DASHBOARD_PASSWORD/,
			)
		})

		it('treats an empty-string secret as missing', async () => {
			const service = createSupabaseService(
				makeCtx({
					PG_EXPORTER_PASSWORD_MYAPP: '',
					POSTGRES_PASSWORD: 'pgpass',
					JWT_SECRET: 'jwt',
					DASHBOARD_PASSWORD: 'dash',
				}),
			)

			await expect(service.loadEnv()).rejects.toThrow(
				/PG_EXPORTER_PASSWORD_MYAPP/,
			)
		})
	})
})

describe('supabaseServiceDefinition', () => {
	it('returns null when [services.supabase] is not declared', () => {
		expect(supabaseServiceDefinition.build({}, makeCtx())).toBeNull()
	})

	it('builds the supabase service when [services.supabase] is declared', () => {
		const service = supabaseServiceDefinition.build(
			{ supabase: {} },
			makeCtx(),
		)
		expect(service?.name).toBe('supabase')
	})
})
