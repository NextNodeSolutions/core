import type { SshSession } from '#/adapters/hetzner/ssh/session.types.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConvergenceInput } from './converge.ts'
import { converge } from './converge.ts'

const VECTOR_TOML = '[sources.docker]\ntype = "docker_logs"\n'
const VECTOR_ENV = 'NN_CLIENT_ID=nextnode\nNN_PROJECT=acme\n'
const CADDY_CONFIG = '{"apps":{}}'

function makeInput(overrides?: Partial<ConvergenceInput>): ConvergenceInput {
	return {
		projectName: 'acme-web',
		vectorToml: VECTOR_TOML,
		vectorEnv: VECTOR_ENV,
		caddyConfig: CADDY_CONFIG,
		...overrides,
	}
}

function createFakeSession(
	files: Map<string, string>,
): SshSession & { execCalls: string[] } {
	const execCalls: string[] = []

	return {
		execCalls,
		exec: vi.fn(async (cmd: string) => {
			execCalls.push(cmd)
			return ''
		}),
		execWithStdin: vi.fn(async (cmd: string) => {
			execCalls.push(cmd)
			return ''
		}),
		writeFile: vi.fn(async (path: string, content: string) => {
			files.set(path, content)
		}),
		readFile: vi.fn(async (path: string) => files.get(path) ?? null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('converge', () => {
	it('writes all config files on first run', async () => {
		const files = new Map<string, string>()
		const session = createFakeSession(files)

		await converge(session, makeInput())

		expect(files.get('/etc/vector/vector.toml')).toBe(VECTOR_TOML)
		expect(files.get('/etc/vector/vector.env')).toBe(VECTOR_ENV)
		expect(files.get('/etc/caddy/config.json')).toBe(CADDY_CONFIG)
	})

	it('restarts vector when toml changes', async () => {
		const files = new Map<string, string>([
			['/etc/vector/vector.toml', 'old-toml'],
			['/etc/vector/vector.env', VECTOR_ENV],
			['/etc/caddy/config.json', CADDY_CONFIG],
		])
		const session = createFakeSession(files)

		await converge(session, makeInput())

		expect(session.execCalls).toContain('sudo systemctl restart vector')
	})

	it('restarts vector when env changes', async () => {
		const files = new Map<string, string>([
			['/etc/vector/vector.toml', VECTOR_TOML],
			['/etc/vector/vector.env', 'old-env'],
			['/etc/caddy/config.json', CADDY_CONFIG],
		])
		const session = createFakeSession(files)

		await converge(session, makeInput())

		expect(session.execCalls).toContain('sudo systemctl restart vector')
	})

	it('restarts caddy when config changes', async () => {
		const files = new Map<string, string>([
			['/etc/vector/vector.toml', VECTOR_TOML],
			['/etc/vector/vector.env', VECTOR_ENV],
			['/etc/caddy/config.json', '{"old": true}'],
		])
		const session = createFakeSession(files)

		await converge(session, makeInput())

		expect(session.execCalls).toContain('sudo systemctl restart caddy')
	})

	it('does not restart services when nothing changed', async () => {
		const files = new Map<string, string>([
			['/etc/vector/vector.toml', VECTOR_TOML],
			['/etc/vector/vector.env', VECTOR_ENV],
			['/etc/caddy/config.json', CADDY_CONFIG],
		])
		const session = createFakeSession(files)

		await converge(session, makeInput())

		const restartCalls = session.execCalls.filter(c =>
			c.startsWith('sudo systemctl restart'),
		)
		expect(restartCalls).toHaveLength(0)
	})

	it('creates project directories for dev and production', async () => {
		const files = new Map<string, string>([
			['/etc/vector/vector.toml', VECTOR_TOML],
			['/etc/vector/vector.env', VECTOR_ENV],
			['/etc/caddy/config.json', CADDY_CONFIG],
		])
		const session = createFakeSession(files)

		await converge(session, makeInput())

		expect(session.execCalls).toContain(
			"mkdir -p '/opt/apps/acme-web/dev' '/opt/apps/acme-web/production'",
		)
	})

	it('does not chown project dir (SSH user is deploy, mkdir already owned by deploy)', async () => {
		const files = new Map<string, string>()
		const session = createFakeSession(files)

		await converge(session, makeInput())

		const chownCalls = session.execCalls.filter(c => c.startsWith('chown'))
		expect(chownCalls).toHaveLength(0)
	})

	it('skips Vector when vectorToml and vectorEnv are undefined', async () => {
		const files = new Map<string, string>()
		const session = createFakeSession(files)

		await converge(
			session,
			makeInput({ vectorToml: undefined, vectorEnv: undefined }),
		)

		expect(files.has('/etc/vector/vector.toml')).toBe(false)
		expect(files.has('/etc/vector/vector.env')).toBe(false)
		expect(session.execCalls).not.toContain('systemctl restart vector')
	})

	it('is idempotent - second run is a no-op', async () => {
		const files = new Map<string, string>()
		const session = createFakeSession(files)
		const input = makeInput()

		await converge(session, input)

		// Reset exec calls, keep written files
		session.execCalls.length = 0

		await converge(session, input)

		const restartCalls = session.execCalls.filter(c =>
			c.startsWith('sudo systemctl restart'),
		)
		expect(restartCalls).toHaveLength(0)
	})
})
