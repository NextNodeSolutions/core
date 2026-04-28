import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SshSession } from './ssh/session.types.ts'
import type { HcloudConvergedState } from './state/types.ts'
import {
	releaseProjectHostPort,
	teardownProjectCaddyRoute,
	teardownProjectContainer,
} from './teardown-project.ts'
import type { TeardownCaddyContext } from './teardown-project.ts'

const CADDY_CONTEXT: TeardownCaddyContext = {
	vpsName: 'nn-prod',
	infraStorage: {
		accountId: 'acct',
		endpoint: 'https://acct.r2.cloudflarestorage.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	},
	acmeEmail: 'infra@nextnode.fr',
	internal: false,
}

function createMockSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		execWithStdin: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

function createMockR2(): ObjectStoreClient {
	return {
		get: vi.fn(),
		put: vi.fn(async () => 'new-etag'),
		delete: vi.fn(),
		exists: vi.fn(),
		deleteByPrefix: vi.fn(),
	}
}

function buildConvergedState(
	hostPorts: Record<string, number>,
): HcloudConvergedState {
	return {
		phase: 'converged',
		serverId: 42,
		publicIp: '1.2.3.4',
		tailnetIp: '100.64.0.1',
		convergedAt: '2026-04-17T10:00:00.000Z',
		hostPorts,
	}
}

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

describe('teardownProjectContainer', () => {
	it('reports not deployed when compose file is missing', async () => {
		const session = createMockSession()

		const outcome = await teardownProjectContainer(
			session,
			'acme-web',
			'production',
		)

		expect(outcome).toEqual({ handled: false, detail: 'not deployed' })
		expect(session.exec).not.toHaveBeenCalled()
	})

	it('runs docker compose down and removes the bind mount when compose exists', async () => {
		const session = createMockSession()
		vi.mocked(session.readFile).mockResolvedValueOnce('services: {}')

		const outcome = await teardownProjectContainer(
			session,
			'acme-web',
			'production',
		)

		expect(outcome.handled).toBe(true)
		expect(session.exec).toHaveBeenCalledWith(
			expect.stringContaining(
				"docker compose -p 'acme-web-production' -f '/opt/apps/acme-web/production/compose.yaml' down -v --remove-orphans",
			),
		)
		expect(session.exec).toHaveBeenCalledWith(
			"rm -rf '/opt/apps/acme-web/production'",
		)
	})
})

describe('teardownProjectCaddyRoute', () => {
	it('reports no domain when hostname is undefined', async () => {
		const session = createMockSession()

		const outcome = await teardownProjectCaddyRoute(
			session,
			undefined,
			CADDY_CONTEXT,
		)

		expect(outcome).toEqual({
			handled: false,
			detail: 'no domain configured',
		})
	})

	it('reports no caddy config when the file is missing', async () => {
		const session = createMockSession()
		vi.mocked(session.readFile).mockResolvedValueOnce(null)

		const outcome = await teardownProjectCaddyRoute(
			session,
			'acme-web.example.com',
			CADDY_CONTEXT,
		)

		expect(outcome).toEqual({ handled: false, detail: 'no caddy config' })
	})

	it('reports no route when project hostname is absent from config', async () => {
		const session = createMockSession()
		vi.mocked(session.readFile).mockResolvedValueOnce(
			JSON.stringify({
				apps: {
					http: {
						servers: {
							https: {
								listen: [':443'],
								routes: [
									{
										match: [
											{ host: ['other.example.com'] },
										],
										handle: [
											{
												handler: 'reverse_proxy',
												upstreams: [
													{ dial: 'localhost:8080' },
												],
											},
										],
										terminal: true,
									},
								],
							},
						},
					},
				},
			}),
		)

		const outcome = await teardownProjectCaddyRoute(
			session,
			'acme-web.example.com',
			CADDY_CONTEXT,
		)

		expect(outcome).toEqual({
			handled: false,
			detail: 'no route for project hostname',
		})
	})

	it('writes an empty config and reloads Caddy when the project is the sole route', async () => {
		const session = createMockSession()
		vi.mocked(session.readFile).mockResolvedValueOnce(
			JSON.stringify({
				apps: {
					http: {
						servers: {
							https: {
								listen: [':443'],
								routes: [
									{
										match: [
											{ host: ['acme-web.example.com'] },
										],
										handle: [
											{
												handler: 'reverse_proxy',
												upstreams: [
													{ dial: 'localhost:8080' },
												],
											},
										],
										terminal: true,
									},
								],
							},
						},
					},
				},
			}),
		)

		const outcome = await teardownProjectCaddyRoute(
			session,
			'acme-web.example.com',
			CADDY_CONTEXT,
		)

		expect(outcome.handled).toBe(true)
		expect(session.writeFile).toHaveBeenCalledWith(
			'/etc/caddy/config.json',
			expect.stringContaining('"servers":{}'),
		)
		expect(session.exec).toHaveBeenCalledWith(
			'caddy reload --config /etc/caddy/config.json',
		)
	})

	it('rebuilds the Caddy config preserving sibling project routes', async () => {
		const session = createMockSession()
		vi.mocked(session.readFile).mockResolvedValueOnce(
			JSON.stringify({
				apps: {
					http: {
						servers: {
							https: {
								listen: [':443'],
								routes: [
									{
										match: [
											{ host: ['acme-web.example.com'] },
										],
										handle: [
											{
												handler: 'reverse_proxy',
												upstreams: [
													{ dial: 'localhost:8080' },
												],
											},
										],
										terminal: true,
									},
									{
										match: [
											{ host: ['other.example.com'] },
										],
										handle: [
											{
												handler: 'reverse_proxy',
												upstreams: [
													{ dial: 'localhost:8081' },
												],
											},
										],
										terminal: true,
									},
								],
							},
						},
					},
				},
			}),
		)

		const outcome = await teardownProjectCaddyRoute(
			session,
			'acme-web.example.com',
			CADDY_CONTEXT,
		)

		expect(outcome.handled).toBe(true)
		const writtenConfig = vi
			.mocked(session.writeFile)
			.mock.calls.find(([path]) => path === '/etc/caddy/config.json')?.[1]
		expect(writtenConfig).toBeDefined()
		expect(writtenConfig).toContain('other.example.com')
		expect(writtenConfig).not.toContain('acme-web.example.com')
		expect(session.exec).toHaveBeenCalledWith(
			'caddy reload --config /etc/caddy/config.json',
		)
	})
})

describe('releaseProjectHostPort', () => {
	it('reports no port allocated when project has no entry (idempotent)', async () => {
		const r2 = createMockR2()
		const state = buildConvergedState({ 'other-project': 8080 })

		const outcome = await releaseProjectHostPort(
			r2,
			'nn-prod',
			'acme-web',
			state,
			'etag-1',
		)

		expect(outcome).toEqual({ handled: false, detail: 'no port allocated' })
		expect(r2.put).not.toHaveBeenCalled()
	})

	it('removes the project entry and persists state under the ETag lock', async () => {
		const r2 = createMockR2()
		const state = buildConvergedState({ 'acme-web': 8080 })

		const outcome = await releaseProjectHostPort(
			r2,
			'nn-prod',
			'acme-web',
			state,
			'etag-1',
		)

		expect(outcome).toEqual({ handled: true, detail: 'port 8080 released' })
		expect(r2.put).toHaveBeenCalledTimes(1)
		const [key, body, ifMatch] = vi.mocked(r2.put).mock.calls[0]!
		expect(key).toBe('hetzner/nn-prod.json')
		expect(ifMatch).toBe('etag-1')
		const persisted: unknown = JSON.parse(body)
		expect(persisted).toMatchObject({
			phase: 'converged',
			hostPorts: {},
		})
	})

	it('preserves sibling project ports when releasing one project', async () => {
		const r2 = createMockR2()
		const state = buildConvergedState({
			'acme-web': 8080,
			'other-project': 8081,
		})

		const outcome = await releaseProjectHostPort(
			r2,
			'nn-prod',
			'acme-web',
			state,
			'etag-1',
		)

		expect(outcome.handled).toBe(true)
		const [, body] = vi.mocked(r2.put).mock.calls[0]!
		expect(JSON.parse(body)).toMatchObject({
			hostPorts: { 'other-project': 8081 },
		})
		expect(JSON.parse(body)).not.toMatchObject({
			hostPorts: { 'acme-web': expect.anything() },
		})
	})
})
