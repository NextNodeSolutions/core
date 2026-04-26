import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SshSession } from './ssh/session.types.ts'
import {
	teardownProjectCaddyRoute,
	teardownProjectContainer,
} from './teardown-project.ts'
import type { TeardownCaddyContext } from './teardown-project.ts'

const CADDY_CONTEXT: TeardownCaddyContext = {
	vpsName: 'nn-prod',
	r2: {
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
