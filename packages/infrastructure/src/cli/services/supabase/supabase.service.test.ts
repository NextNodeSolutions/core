import type { OrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	createSupabaseService,
	ensurePgExporterPasswordSecret,
	generatePgExporterPassword,
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
		it('projects the GitHub org secret into PG_EXPORTER_PASSWORD on the secret channel', async () => {
			const service = createSupabaseService(
				makeCtx({ PG_EXPORTER_PASSWORD_MYAPP: 'b64passwd' }),
			)

			await expect(service.loadEnv()).resolves.toEqual({
				public: {},
				secret: { PG_EXPORTER_PASSWORD: 'b64passwd' },
			})
		})

		it('reads under the project-derived name (kebab → snake-upper)', async () => {
			const service = createSupabaseService(
				makeCtx(
					{ PG_EXPORTER_PASSWORD_MY_COOL_APP: 'b64passwd' },
					'my-cool-app',
				),
			)

			const env = await service.loadEnv()
			expect(env.secret).toEqual({ PG_EXPORTER_PASSWORD: 'b64passwd' })
		})

		it('throws when the org secret is missing from ALL_SECRETS', async () => {
			const service = createSupabaseService(makeCtx({}))

			await expect(service.loadEnv()).rejects.toThrow(
				/GitHub org secret "PG_EXPORTER_PASSWORD_MYAPP" must be defined/,
			)
		})

		it('throws when the org secret is set to an empty string', async () => {
			const service = createSupabaseService(
				makeCtx({ PG_EXPORTER_PASSWORD_MYAPP: '' }),
			)

			await expect(service.loadEnv()).rejects.toThrow(/must be defined/)
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
