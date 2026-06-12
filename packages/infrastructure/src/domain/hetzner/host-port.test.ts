import { describe, expect, it } from 'vitest'

import { HOST_PORT_MAX, HOST_PORT_MIN, allocateHostPort } from './host-port.ts'

describe('allocateHostPort', () => {
	it('assigns the lowest port in range to a single fresh url service', () => {
		expect(allocateHostPort({}, 'acme-web', ['front'])).toEqual({
			ports: { front: HOST_PORT_MIN },
			hasAllocated: true,
		})
	})

	it('assigns distinct ports to two fresh url services of the same project', () => {
		expect(allocateHostPort({}, 'acme-web', ['front', 'api'])).toEqual({
			ports: { front: HOST_PORT_MIN, api: HOST_PORT_MIN + 1 },
			hasAllocated: true,
		})
	})

	it('reuses every existing port and skips allocation when nothing is new', () => {
		const hostPorts = { 'acme-web': { front: 8085, api: 8090 } }
		expect(
			allocateHostPort(hostPorts, 'acme-web', ['front', 'api']),
		).toEqual({
			ports: { front: 8085, api: 8090 },
			hasAllocated: false,
		})
	})

	it('reuses an existing port even when it sits outside the default range', () => {
		const hostPorts = { 'legacy-app': { web: 9001 } }
		expect(allocateHostPort(hostPorts, 'legacy-app', ['web'])).toEqual({
			ports: { web: 9001 },
			hasAllocated: false,
		})
	})

	it('reuses one service and allocates the other when only some are new', () => {
		const hostPorts = { 'acme-web': { front: 8085 } }
		expect(
			allocateHostPort(hostPorts, 'acme-web', ['front', 'api']),
		).toEqual({
			ports: { front: 8085, api: HOST_PORT_MIN },
			hasAllocated: true,
		})
	})

	it('skips ports already taken by other projects on the same VPS', () => {
		const hostPorts = {
			'other-a': { web: HOST_PORT_MIN },
			'other-b': { web: HOST_PORT_MIN + 1 },
		}
		expect(allocateHostPort(hostPorts, 'acme-web', ['front'])).toEqual({
			ports: { front: HOST_PORT_MIN + 2 },
			hasAllocated: true,
		})
	})

	it('fills a hole left between ports taken by other projects', () => {
		const hostPorts = {
			'other-a': { web: HOST_PORT_MIN },
			'other-b': { web: HOST_PORT_MIN + 2 },
		}
		expect(allocateHostPort(hostPorts, 'acme-web', ['front'])).toEqual({
			ports: { front: HOST_PORT_MIN + 1 },
			hasAllocated: true,
		})
	})

	it('returns an empty map without allocating when no service declares a url', () => {
		const hostPorts = { 'acme-web': { front: 8080 } }
		expect(allocateHostPort(hostPorts, 'acme-web', [])).toEqual({
			ports: {},
			hasAllocated: false,
		})
	})

	it('does not mutate the input map', () => {
		const hostPorts = { 'acme-web': { front: HOST_PORT_MIN } }
		allocateHostPort(hostPorts, 'acme-web', ['front', 'api'])
		expect(hostPorts).toStrictEqual({
			'acme-web': { front: HOST_PORT_MIN },
		})
	})

	it('throws when the range is exhausted by other projects', () => {
		const hostPorts: Record<string, Record<string, number>> = {}
		for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
			hostPorts[`p-${port}`] = { web: port }
		}
		expect(() =>
			allocateHostPort(hostPorts, 'acme-web', ['front']),
		).toThrow(/exhausted/)
	})

	it('still reuses a known service port when the range is otherwise exhausted', () => {
		const hostPorts: Record<string, Record<string, number>> = {}
		for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
			hostPorts[`p-${port}`] = { web: port }
		}
		expect(
			allocateHostPort(hostPorts, `p-${HOST_PORT_MIN}`, ['web']),
		).toEqual({
			ports: { web: HOST_PORT_MIN },
			hasAllocated: false,
		})
	})
})
