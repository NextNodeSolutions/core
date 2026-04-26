import { describe, expect, it } from 'vitest'

import { findOrphanVps } from './orphans.ts'

describe('findOrphanVps', () => {
	it('returns empty when every server has matching state', () => {
		const orphans = findOrphanVps(
			[
				{ id: 1, vpsName: 'foo' },
				{ id: 2, vpsName: 'bar' },
			],
			new Set(['foo', 'bar']),
		)
		expect(orphans).toEqual([])
	})

	it('returns vps without state', () => {
		const orphans = findOrphanVps(
			[
				{ id: 1, vpsName: 'foo' },
				{ id: 2, vpsName: 'orphan-1' },
			],
			new Set(['foo']),
		)
		expect(orphans).toEqual([{ vpsName: 'orphan-1', serverIds: [2] }])
	})

	it('groups multiple servers under the same vpsName', () => {
		const orphans = findOrphanVps(
			[
				{ id: 1, vpsName: 'orphan-1' },
				{ id: 2, vpsName: 'orphan-1' },
				{ id: 3, vpsName: 'orphan-2' },
			],
			new Set(),
		)
		expect(orphans).toContainEqual({
			vpsName: 'orphan-1',
			serverIds: [1, 2],
		})
		expect(orphans).toContainEqual({
			vpsName: 'orphan-2',
			serverIds: [3],
		})
		expect(orphans).toHaveLength(2)
	})

	it('treats empty inventory as no orphans', () => {
		expect(findOrphanVps([], new Set())).toEqual([])
	})
})
