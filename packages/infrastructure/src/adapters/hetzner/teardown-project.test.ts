import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { R2Operations } from '../r2/client.types.ts'

import type { SshSession } from './ssh/session.types.ts'
import {
	teardownProjectCaddyRoute,
	teardownProjectCerts,
	teardownProjectContainer,
} from './teardown-project.ts'

function createMockSession(): SshSession {
	return {
		exec: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
	}
}

function createMockR2(): R2Operations {
	return {
		get: vi.fn(async () => null),
		put: vi.fn(async () => ''),
		delete: vi.fn(async () => undefined),
		exists: vi.fn(async () => false),
		deleteByPrefix: vi.fn(async () => 0),
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
				'docker compose -p acme-web-production -f /opt/apps/acme-web/production/compose.yaml down -v --remove-orphans',
			),
		)
		expect(session.exec).toHaveBeenCalledWith(
			'rm -rf /opt/apps/acme-web/production',
		)
	})
})

describe('teardownProjectCaddyRoute', () => {
	it('reports no domain when hostname is undefined', async () => {
		const session = createMockSession()

		const outcome = await teardownProjectCaddyRoute(session, undefined)

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

	it('fails loud when other project routes coexist (colocation not supported)', async () => {
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

		await expect(
			teardownProjectCaddyRoute(session, 'acme-web.example.com'),
		).rejects.toThrow(/colocation teardown not yet supported/)
	})
})

describe('teardownProjectCerts', () => {
	it('calls deleteByPrefix with the project prefix', async () => {
		const r2 = createMockR2()

		await teardownProjectCerts(r2, 'acme-web')

		expect(r2.deleteByPrefix).toHaveBeenCalledWith('acme-web/')
	})

	it('reports handled=false when no cert objects exist', async () => {
		const r2 = createMockR2()
		vi.mocked(r2.deleteByPrefix).mockResolvedValueOnce(0)

		const outcome = await teardownProjectCerts(r2, 'acme-web')

		expect(outcome).toEqual({
			handled: false,
			detail: '0 cert object(s) deleted',
		})
	})

	it('reports handled=true when certs are deleted', async () => {
		const r2 = createMockR2()
		vi.mocked(r2.deleteByPrefix).mockResolvedValueOnce(4)

		const outcome = await teardownProjectCerts(r2, 'acme-web')

		expect(outcome).toEqual({
			handled: true,
			detail: '4 cert object(s) deleted',
		})
	})
})
