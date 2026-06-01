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

const buildService = (port: number, url?: string): UserServiceConfig => ({
	port,
	...(url !== undefined && { url }),
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
})

// front declares SESSION_KEY, api declares JWT_SECRET; the deploy secrets pool
// carries both. Per-service projection (D5) must hand each service only the
// subset it declares.
const secretService = (url: string, secrets: string[]): UserServiceConfig => ({
	port: 3000,
	url,
	secrets,
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
})

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

	// front + api route externally (each gets a url + host port); worker is
	// internal-only (no url). renderComposeFile needs an image per service and a
	// host port per url service, so all three are wired here.
	const multiServiceInput = (): DeployContainerInput => ({
		projectName: 'acme-web',
		environment: 'production',
		hostPorts: { front: 8080, api: 8081 },
		env: { SITE_URL: 'https://example.com' },
		secrets: {},
		images: { front: IMAGE, api: IMAGE, worker: IMAGE },
		registryToken: undefined,
		volumes: [],
		postgres: undefined,
		services: {
			front: buildService(3000, 'example.com'),
			api: buildService(4000, 'api.example.com'),
			worker: buildService(5000),
		},
	})

	it('cross-injects every service url into each per-service env file', async () => {
		const session = recordingSession()

		await stageRollout(session, multiServiceInput())

		const envFiles = ['front', 'api', 'worker'].map(name =>
			writtenFile(session, `/opt/apps/acme-web/production/.env.${name}`),
		)
		for (const env of envFiles) {
			expect(env).toContain('FRONT_URL=example.com')
			expect(env).toContain('API_URL=api.example.com')
		}
	})

	it('never injects a <NAME>_URL for a service that declares no url', async () => {
		const session = recordingSession()

		await stageRollout(session, multiServiceInput())

		const envFiles = ['front', 'api', 'worker'].map(name =>
			writtenFile(session, `/opt/apps/acme-web/production/.env.${name}`),
		)
		for (const env of envFiles) {
			expect(env).not.toContain('WORKER_URL')
		}
	})

	const secretInput = (
		secrets: Readonly<Record<string, string>>,
	): DeployContainerInput => ({
		projectName: 'acme-web',
		environment: 'production',
		hostPorts: { front: 8080, api: 8081 },
		env: { SITE_URL: 'https://example.com' },
		secrets,
		images: { front: IMAGE, api: IMAGE },
		registryToken: undefined,
		volumes: [],
		postgres: undefined,
		services: {
			front: secretService('example.com', ['SESSION_KEY']),
			api: secretService('api.example.com', ['JWT_SECRET']),
		},
	})

	it("projects each service's declared secret into its own .env and withholds the others", async () => {
		const session = recordingSession()

		await stageRollout(
			session,
			secretInput({ SESSION_KEY: 'sess-val', JWT_SECRET: 'jwt-val' }),
		)

		const front = writtenFile(
			session,
			'/opt/apps/acme-web/production/.env.front',
		)
		const api = writtenFile(
			session,
			'/opt/apps/acme-web/production/.env.api',
		)

		expect(front).toContain('SESSION_KEY=sess-val')
		expect(front).not.toContain('JWT_SECRET')
		expect(api).toContain('JWT_SECRET=jwt-val')
		expect(api).not.toContain('SESSION_KEY')
	})

	it('broadcasts a service-required secret no service declares (e.g. DATABASE_URL) into every .env', async () => {
		const session = recordingSession()

		await stageRollout(
			session,
			secretInput({
				SESSION_KEY: 'sess-val',
				JWT_SECRET: 'jwt-val',
				DATABASE_URL: 'postgres://db:5432',
			}),
		)

		const front = writtenFile(
			session,
			'/opt/apps/acme-web/production/.env.front',
		)
		const api = writtenFile(
			session,
			'/opt/apps/acme-web/production/.env.api',
		)

		expect(front).toContain('DATABASE_URL=postgres://db:5432')
		expect(api).toContain('DATABASE_URL=postgres://db:5432')
	})

	// The forwarded token authenticates every registry the deploy pulls from,
	// not just the `build` services' GHCR: an upstream service on a different
	// registry must get its own login, and services sharing a registry collapse
	// to a single `docker login`.
	it('logs in once per distinct image registry across every service, regardless of source', async () => {
		const session = recordingSession()
		const upstreamService = (
			port: number,
			url: string,
		): UserServiceConfig => ({
			port,
			url,
			secrets: [],
			needs: [],
			dependsOn: [],
			source: 'upstream',
			ref: 'docker.io/acme/api:v1',
		})

		await stageRollout(session, {
			projectName: 'acme-web',
			environment: 'production',
			hostPorts: { front: 8080, api: 8081 },
			env: { SITE_URL: 'https://example.com' },
			secrets: {},
			images: {
				front: {
					registry: 'ghcr.io',
					repository: 'acme/web',
					tag: 'sha-abc1234',
				},
				api: {
					registry: 'docker.io',
					repository: 'acme/api',
					tag: 'v1',
				},
				worker: {
					registry: 'ghcr.io',
					repository: 'acme/worker',
					tag: 'sha-abc1234',
				},
			},
			registryToken: 'tok',
			volumes: [],
			postgres: undefined,
			services: {
				front: buildService(3000, 'example.com'),
				api: upstreamService(4000, 'api.example.com'),
				worker: buildService(5000),
			},
		})

		const logins = vi
			.mocked(session.execWithStdin)
			.mock.calls.map(([command]) => command)
			.filter(command => command.startsWith('docker login'))

		expect(logins).toHaveLength(2)
		expect(logins.some(command => command.includes("'ghcr.io'"))).toBe(true)
		expect(logins.some(command => command.includes("'docker.io'"))).toBe(
			true,
		)
	})
})
