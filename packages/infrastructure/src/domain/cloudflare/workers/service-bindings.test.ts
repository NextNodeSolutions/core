import { describe, expect, it } from 'vitest'

import { deriveBoundSiblings, orderWorkerDeploy } from './service-bindings.ts'

describe('deriveBoundSiblings', () => {
	it('keeps the needs that name a sibling worker', () => {
		expect(deriveBoundSiblings('web', ['api'], ['web', 'api'])).toEqual([
			'api',
		])
	})

	it('drops a backing need that is not a sibling worker', () => {
		expect(
			deriveBoundSiblings('web', ['d1', 'api'], ['web', 'api']),
		).toEqual(['api'])
	})

	it('never binds the worker to itself', () => {
		expect(deriveBoundSiblings('api', ['api'], ['web', 'api'])).toEqual([])
	})

	it('de-duplicates and preserves needs declaration order', () => {
		expect(
			deriveBoundSiblings(
				'web',
				['api', 'admin', 'api'],
				['web', 'api', 'admin'],
			),
		).toEqual(['api', 'admin'])
	})

	it('binds nothing when needs is empty', () => {
		expect(deriveBoundSiblings('web', [], ['web', 'api'])).toEqual([])
	})
})

const node = (
	needs: ReadonlyArray<string>,
	dependsOn: ReadonlyArray<string> = [],
): { needs: ReadonlyArray<string>; dependsOn: ReadonlyArray<string> } => ({
	needs,
	dependsOn,
})

describe('orderWorkerDeploy', () => {
	it('deploys a bound sibling before the worker that binds it', () => {
		const order = orderWorkerDeploy({
			web: node(['api']),
			admin: node(['api']),
			api: node([]),
		})

		expect(order.indexOf('api')).toBeLessThan(order.indexOf('web'))
		expect(order.indexOf('api')).toBeLessThan(order.indexOf('admin'))
	})

	it('keeps declaration order for independent workers', () => {
		expect(orderWorkerDeploy({ api: node([]), web: node([]) })).toEqual([
			'api',
			'web',
		])
	})

	it('honours an explicit depends_on alongside binding order', () => {
		const order = orderWorkerDeploy({
			web: node([], ['api']),
			api: node([]),
		})

		expect(order).toEqual(['api', 'web'])
	})

	it('ignores a backing need for ordering (only siblings order)', () => {
		expect(orderWorkerDeploy({ web: node(['d1']), api: node([]) })).toEqual(
			['web', 'api'],
		)
	})

	it('throws on a binding cycle, naming the tangled workers', () => {
		expect(() =>
			orderWorkerDeploy({ web: node(['api']), api: node(['web']) }),
		).toThrow(/cycle/)
	})
})
