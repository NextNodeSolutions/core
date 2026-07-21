import { describe, expect, it } from 'vitest'

import { orderServicesByDependsOn } from './depends-on-order.ts'

const node = (
	dependsOn: ReadonlyArray<string> = [],
): { dependsOn: ReadonlyArray<string> } => ({
	dependsOn,
})

describe('orderServicesByDependsOn', () => {
	it('keeps declaration order when nothing depends on anything', () => {
		expect(
			orderServicesByDependsOn({
				web: node(),
				api: node(),
				admin: node(),
			}),
		).toEqual(['web', 'api', 'admin'])
	})

	it('places every dependency before the service that depends on it', () => {
		const order = orderServicesByDependsOn({
			web: node(['api']),
			api: node(['db']),
			db: node(),
		})

		expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'))
		expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'))
		expect(order).toEqual(['db', 'api', 'web'])
	})

	it('is deterministic for independent branches (stable by declaration order)', () => {
		const order = orderServicesByDependsOn({
			a: node(),
			b: node(['a']),
			c: node(),
			d: node(['c']),
		})

		expect(order).toEqual(['a', 'c', 'b', 'd'])
	})

	it('throws an actionable error naming the services in a cycle', () => {
		expect(() =>
			orderServicesByDependsOn({
				web: node(['api']),
				api: node(['web']),
			}),
		).toThrow(/depends_on forms a cycle among: web, api/)
	})

	it('returns an empty order for no services', () => {
		expect(orderServicesByDependsOn({})).toEqual([])
	})
})
