import { describe, expect, it } from 'vitest'

import { HOST_PORT_MAX, HOST_PORT_MIN, allocateHostPort } from './host-port.ts'

describe('allocateHostPort', () => {
	it('returns the lowest port in range when hostPorts is empty', () => {
		expect(allocateHostPort({}, 'acme-web')).toBe(HOST_PORT_MIN)
	})

	it('is idempotent for a known project', () => {
		const hostPorts = { 'acme-web': 8085 }
		expect(allocateHostPort(hostPorts, 'acme-web')).toBe(8085)
	})

	it('returns the existing port even when it sits outside the default range', () => {
		const hostPorts = { 'legacy-app': 9001 }
		expect(allocateHostPort(hostPorts, 'legacy-app')).toBe(9001)
	})

	it('allocates the lowest free port skipping taken ones', () => {
		const hostPorts = {
			'acme-web': HOST_PORT_MIN,
			'acme-api': HOST_PORT_MIN + 1,
		}
		expect(allocateHostPort(hostPorts, 'fresh')).toBe(HOST_PORT_MIN + 2)
	})

	it('fills holes left by released ports', () => {
		const hostPorts = {
			'acme-web': HOST_PORT_MIN,
			'acme-api': HOST_PORT_MIN + 2,
		}
		expect(allocateHostPort(hostPorts, 'fresh')).toBe(HOST_PORT_MIN + 1)
	})

	it('does not mutate the input map', () => {
		const hostPorts = { 'acme-web': HOST_PORT_MIN }
		allocateHostPort(hostPorts, 'fresh')
		expect(hostPorts).toStrictEqual({ 'acme-web': HOST_PORT_MIN })
	})

	it('throws when the range is exhausted', () => {
		const hostPorts: Record<string, number> = {}
		for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
			hostPorts[`p-${port}`] = port
		}
		expect(() => allocateHostPort(hostPorts, 'fresh')).toThrow(/exhausted/)
	})

	it('still returns the existing port for a known project even when range is exhausted', () => {
		const hostPorts: Record<string, number> = {}
		for (let port = HOST_PORT_MIN; port < HOST_PORT_MAX; port++) {
			hostPorts[`p-${port}`] = port
		}
		expect(allocateHostPort(hostPorts, `p-${HOST_PORT_MIN}`)).toBe(
			HOST_PORT_MIN,
		)
	})
})
