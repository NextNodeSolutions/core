import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { bringUpApp, bringUpDb, stageRollout } from './deploy-container.ts'

import type {
	PostgresServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { BringUpInput, DeployContainerInput } from './deploy-container.ts'
import type { SshSession } from './ssh/session.types.ts'

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

const POSTGRES_CONFIG: PostgresServiceConfig = {
	mode: 'embedded',
}

const BASE_INPUT: BringUpInput = {
	projectName: 'acme-web',
	environment: 'production',
	postgres: POSTGRES_CONFIG,
}

function recordingSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		execWithStdin: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

describe('bringUpDb', () => {
	it('issues a single `up -d --wait` for postgres + postgres-backup', async () => {
		const session = recordingSession()

		await bringUpDb(session, BASE_INPUT)

		expect(session.exec).toHaveBeenCalledExactlyOnceWith(
			"docker compose -p 'acme-web-production' -f '/opt/apps/acme-web/production/compose.yaml' up -d --wait --wait-timeout 60 postgres postgres-backup",
		)
	})

	it('propagates the SSH/compose error when docker compose --wait times out or fails', async () => {
		const session = recordingSession()
		vi.mocked(session.exec).mockRejectedValueOnce(
			new Error('container acme-web-production-postgres-1 is unhealthy'),
		)

		await expect(bringUpDb(session, BASE_INPUT)).rejects.toThrow(
			/is unhealthy/,
		)
	})

	it('is a no-op when the project does not declare a postgres service', async () => {
		const session = recordingSession()

		await bringUpDb(session, { ...BASE_INPUT, postgres: undefined })

		expect(session.exec).not.toHaveBeenCalled()
	})

	it('targets the development silo when environment is development', async () => {
		const session = recordingSession()

		await bringUpDb(session, { ...BASE_INPUT, environment: 'development' })

		expect(session.exec).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining(
				"-p 'acme-web-development' -f '/opt/apps/acme-web/development/compose.yaml'",
			),
		)
	})
})

describe('bringUpApp', () => {
	it('rotates the whole compose file with no positional service (regardless of whether postgres is staged)', async () => {
		const withPg = recordingSession()
		const noPg = recordingSession()

		await bringUpApp(withPg, BASE_INPUT)
		await bringUpApp(noPg, { ...BASE_INPUT, postgres: undefined })

		const expected =
			"docker compose -p 'acme-web-production' -f '/opt/apps/acme-web/production/compose.yaml' up -d --remove-orphans"
		expect(withPg.exec).toHaveBeenCalledExactlyOnceWith(expected)
		expect(noPg.exec).toHaveBeenCalledExactlyOnceWith(expected)
	})

	it('escapes shell metacharacters in the project name', async () => {
		const session = recordingSession()

		await bringUpApp(session, {
			...BASE_INPUT,
			projectName: 'acme;rm -rf /',
		})

		expect(session.exec).toHaveBeenCalledExactlyOnceWith(
			expect.stringContaining("-p 'acme;rm -rf /-production'"),
		)
	})
})

describe('stageRollout', () => {
	const IMAGE: ImageRef = {
		registry: 'ghcr.io',
		repository: 'acme/web',
		tag: 'sha-abc123',
	}

	const stageInput = (
		service: UserServiceConfig,
		name: string,
	): DeployContainerInput => ({
		projectName: 'acme-web',
		environment: 'production',
		hostPorts: { [name]: 8080 },
		env: { SITE_URL: 'https://acme-web.example.com' },
		secrets: {},
		images: { [name]: IMAGE },
		registryToken: undefined,
		volumes: [],
		postgres: undefined,
		services: { [name]: service },
	})

	const writtenFile = (session: SshSession, path: string): string => {
		const write = vi
			.mocked(session.writeFile)
			.mock.calls.find(([target]) => target === path)
		expect(write).toBeDefined()
		return write?.[1] ?? ''
	}

	it('injects the declared service.port as the PORT env var (not a hardcoded 3000)', async () => {
		const session = recordingSession()

		await stageRollout(
			session,
			stageInput(
				{
					port: 4000,
					url: 'acme-web.example.com',
					secrets: [],
					needs: [],
					dependsOn: [],
					source: 'build',
					target: 'app',
				},
				'app',
			),
		)

		const env = writtenFile(
			session,
			'/opt/apps/acme-web/production/.env.app',
		)
		expect(env).toContain('PORT=4000')
	})

	it('writes the env file under the declared service name, not a hardcoded "app"', async () => {
		const session = recordingSession()

		await stageRollout(
			session,
			stageInput(
				{
					port: 3000,
					secrets: [],
					needs: [],
					dependsOn: [],
					source: 'build',
					target: 'web',
				},
				'web',
			),
		)

		const paths = vi
			.mocked(session.writeFile)
			.mock.calls.map(([target]) => target)
		expect(paths).toContain('/opt/apps/acme-web/production/.env.web')
	})
})
