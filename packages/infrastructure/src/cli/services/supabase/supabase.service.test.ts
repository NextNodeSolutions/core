import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import type { OrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { R2ServiceState } from '#/domain/services/r2.ts'
import { SUPABASE_KONG_HTTP_PORT } from '#/domain/services/supabase.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadR2ServiceMock = vi.hoisted(() => vi.fn())

vi.mock('#/cli/services/r2/load.ts', () => ({
	loadR2Service: loadR2ServiceMock,
}))

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

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://infra.r2.example.com',
	accessKeyId: 'infra-ak',
	secretAccessKey: 'infra-sk',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

const R2_STATE: R2ServiceState = {
	endpoint: 'https://acct-123.r2.cloudflarestorage.com',
	accessKeyId: 'svc-ak',
	secretAccessKey: 'svc-sk',
	buckets: [{ alias: 'backups', name: 'myapp-production-backups' }],
}

function makeCtx(
	repoSecrets: Readonly<Record<string, string>> = {},
	projectName = 'myapp',
	deployDomain: string | null = 'example.com',
	infraStorage: InfraStorageRuntimeConfig | null = INFRA_STORAGE,
): ServiceFactoryContext {
	return {
		projectName,
		environment: 'production',
		repository: { owner: 'NextNodeSolutions', name: 'core' },
		cfToken: 'cf-token',
		infraStorage,
		repoSecrets,
		deployDomain,
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
	loadR2ServiceMock.mockReset()
	loadR2ServiceMock.mockResolvedValue(R2_STATE)
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

	it('throws at construction when infraStorage is null — the R2 state bucket is required to derive BACKUP_R2_* env vars', () => {
		expect(() =>
			createSupabaseService(makeCtx({}, 'myapp', 'example.com', null)),
		).toThrow(/infra storage \(R2 state bucket\) must be loaded/)
	})

	describe('loadEnv', () => {
		const ALL_SECRETS = {
			PG_EXPORTER_PASSWORD_MYAPP: 'pgexp',
			POSTGRES_PASSWORD: 'pgpass',
			JWT_SECRET: 'jwt',
			DASHBOARD_PASSWORD: 'dash',
		} as const

		// Locked-in HS256 outputs for `signSupabaseJwt({role, iss:'supabase', iat:0}, 'jwt')`.
		// Hardcoded (not recomputed via signSupabaseJwt) so the test catches any
		// drift in the JWT signer, header, payload shape, or pinned iat.
		const ANON_KEY_FOR_JWT_SECRET_JWT =
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjowfQ.UGYosjd4EbG0midOUsKjzjmyntV8HQGNMnxxYMWk36Y'
		const SERVICE_ROLE_KEY_FOR_JWT_SECRET_JWT =
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjB9.59lKtvORIYdPzZzs6madu3uA6z-vjz91ouJWqxwCP4w'

		it('surfaces all four supabase secrets under their compose .env keys on the secret channel', async () => {
			const service = createSupabaseService(makeCtx(ALL_SECRETS))

			await expect(service.loadEnv()).resolves.toEqual({
				public: {
					KONG_HTTP_PORT: '8000',
					JWT_EXPIRY: '3600',
					DASHBOARD_USERNAME: 'supabase',
					STUDIO_DEFAULT_ORGANIZATION: 'myapp',
					STUDIO_DEFAULT_PROJECT: 'myapp',
					POOLER_TENANT_ID: 'myapp',
					API_EXTERNAL_URL: 'https://api.example.com',
					SITE_URL: 'https://example.com',
				},
				secret: {
					PG_EXPORTER_PASSWORD: 'pgexp',
					POSTGRES_PASSWORD: 'pgpass',
					JWT_SECRET: 'jwt',
					DASHBOARD_PASSWORD: 'dash',
					ANON_KEY: ANON_KEY_FOR_JWT_SECRET_JWT,
					SERVICE_ROLE_KEY: SERVICE_ROLE_KEY_FOR_JWT_SECRET_JWT,
					BACKUP_R2_ACCESS_KEY_ID: 'svc-ak',
					BACKUP_R2_SECRET_ACCESS_KEY: 'svc-sk',
					BACKUP_R2_ENDPOINT:
						'https://acct-123.r2.cloudflarestorage.com',
					BACKUP_R2_BUCKET: 'myapp-production-backups',
				},
			})
		})

		it('exposes the upstream-template static config vars in the public channel, with the project-scoped studio + pooler ids', async () => {
			const env = await createSupabaseService(
				makeCtx(
					{
						PG_EXPORTER_PASSWORD_MY_COOL_APP: 'pgexp',
						POSTGRES_PASSWORD: 'pgpass',
						JWT_SECRET: 'jwt',
						DASHBOARD_PASSWORD: 'dash',
					},
					'my-cool-app',
				),
			).loadEnv()

			expect(env.public).toEqual({
				KONG_HTTP_PORT: '8000',
				JWT_EXPIRY: '3600',
				DASHBOARD_USERNAME: 'supabase',
				STUDIO_DEFAULT_ORGANIZATION: 'my-cool-app',
				STUDIO_DEFAULT_PROJECT: 'my-cool-app',
				POOLER_TENANT_ID: 'my-cool-app',
				API_EXTERNAL_URL: 'https://api.example.com',
				SITE_URL: 'https://example.com',
			})
		})

		it('exposes API_EXTERNAL_URL on api.<domain> and SITE_URL on the bare domain when deployDomain is the production host', async () => {
			const env = await createSupabaseService(
				makeCtx(ALL_SECRETS, 'myapp', 'example.com'),
			).loadEnv()

			expect(env.public['SITE_URL']).toBe('https://example.com')
			expect(env.public['API_EXTERNAL_URL']).toBe(
				'https://api.example.com',
			)
		})

		it('derives both URLs from the dev subdomain when deployDomain is the dev host', async () => {
			const env = await createSupabaseService(
				makeCtx(ALL_SECRETS, 'myapp', 'dev.example.com'),
			).loadEnv()

			expect(env.public['SITE_URL']).toBe('https://dev.example.com')
			expect(env.public['API_EXTERNAL_URL']).toBe(
				'https://api.dev.example.com',
			)
		})

		it('throws when deployDomain is null — gotrue auth callbacks cannot be silently misconfigured', async () => {
			const service = createSupabaseService(
				makeCtx(ALL_SECRETS, 'myapp', null),
			)

			await expect(service.loadEnv()).rejects.toThrow(
				/project\.domain must be set/,
			)
		})

		it('reuses SUPABASE_KONG_HTTP_PORT from the domain so Caddy and kong share one source of truth for the port', async () => {
			const env = await createSupabaseService(
				makeCtx(ALL_SECRETS),
			).loadEnv()

			expect(env.public['KONG_HTTP_PORT']).toBe(
				String(SUPABASE_KONG_HTTP_PORT),
			)
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
				ANON_KEY: ANON_KEY_FOR_JWT_SECRET_JWT,
				SERVICE_ROLE_KEY: SERVICE_ROLE_KEY_FOR_JWT_SECRET_JWT,
				BACKUP_R2_ACCESS_KEY_ID: 'svc-ak',
				BACKUP_R2_SECRET_ACCESS_KEY: 'svc-sk',
				BACKUP_R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
				BACKUP_R2_BUCKET: 'myapp-production-backups',
			})
		})

		it('derives ANON_KEY and SERVICE_ROLE_KEY deterministically from JWT_SECRET (no random iat)', async () => {
			const first = await createSupabaseService(
				makeCtx(ALL_SECRETS),
			).loadEnv()
			const second = await createSupabaseService(
				makeCtx(ALL_SECRETS),
			).loadEnv()

			expect(first.secret['ANON_KEY']).toBe(ANON_KEY_FOR_JWT_SECRET_JWT)
			expect(first.secret['SERVICE_ROLE_KEY']).toBe(
				SERVICE_ROLE_KEY_FOR_JWT_SECRET_JWT,
			)
			expect(second.secret['ANON_KEY']).toBe(first.secret['ANON_KEY'])
			expect(second.secret['SERVICE_ROLE_KEY']).toBe(
				first.secret['SERVICE_ROLE_KEY'],
			)
		})

		it('rotates ANON_KEY and SERVICE_ROLE_KEY when JWT_SECRET changes', async () => {
			const a = await createSupabaseService(
				makeCtx({ ...ALL_SECRETS, JWT_SECRET: 'secret-a' }),
			).loadEnv()
			const b = await createSupabaseService(
				makeCtx({ ...ALL_SECRETS, JWT_SECRET: 'secret-b' }),
			).loadEnv()

			expect(a.secret['ANON_KEY']).not.toBe(b.secret['ANON_KEY'])
			expect(a.secret['SERVICE_ROLE_KEY']).not.toBe(
				b.secret['SERVICE_ROLE_KEY'],
			)
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

		it('queries loadR2Service with the project + env coordinates from the context', async () => {
			await createSupabaseService(makeCtx(ALL_SECRETS)).loadEnv()

			expect(loadR2ServiceMock).toHaveBeenCalledTimes(1)
			expect(loadR2ServiceMock).toHaveBeenCalledWith({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			})
		})

		it('exposes BACKUP_R2_* in the secret channel, sourced from the R2 service state', async () => {
			const env = await createSupabaseService(
				makeCtx(ALL_SECRETS),
			).loadEnv()

			expect(env.secret).toMatchObject({
				BACKUP_R2_ACCESS_KEY_ID: 'svc-ak',
				BACKUP_R2_SECRET_ACCESS_KEY: 'svc-sk',
				BACKUP_R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
				BACKUP_R2_BUCKET: 'myapp-production-backups',
			})
		})

		it('derives BACKUP_R2_BUCKET from the backups binding even when other R2 aliases coexist', async () => {
			loadR2ServiceMock.mockResolvedValue({
				endpoint: 'https://acct-123.r2.cloudflarestorage.com',
				accessKeyId: 'svc-ak',
				secretAccessKey: 'svc-sk',
				buckets: [
					{ alias: 'uploads', name: 'myapp-production-uploads' },
					{ alias: 'media', name: 'myapp-production-media' },
					{ alias: 'backups', name: 'myapp-production-backups' },
				],
			})

			const env = await createSupabaseService(
				makeCtx(ALL_SECRETS),
			).loadEnv()

			expect(env.secret['BACKUP_R2_BUCKET']).toBe(
				'myapp-production-backups',
			)
		})

		it('throws when the R2 service state has no "backups" alias — the sidecar would have no bucket to write to', async () => {
			loadR2ServiceMock.mockResolvedValue({
				endpoint: 'https://acct-123.r2.cloudflarestorage.com',
				accessKeyId: 'svc-ak',
				secretAccessKey: 'svc-sk',
				buckets: [
					{ alias: 'uploads', name: 'myapp-production-uploads' },
				],
			})

			await expect(
				createSupabaseService(makeCtx(ALL_SECRETS)).loadEnv(),
			).rejects.toThrow(/missing the "backups" bucket alias/)
		})

		it('propagates the loadR2Service rejection when the R2 state cannot be read', async () => {
			loadR2ServiceMock.mockRejectedValue(
				new Error('R2 service state not found — run provision'),
			)

			await expect(
				createSupabaseService(makeCtx(ALL_SECRETS)).loadEnv(),
			).rejects.toThrow(/R2 service state not found/)
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
