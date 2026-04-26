import { afterEach, describe, expect, it, vi } from 'vitest'

import { okJson } from '@/test-fetch.ts'

import { resolveR2PermissionGroupIds } from './permission-groups.ts'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('resolveR2PermissionGroupIds', () => {
	it('picks read and write ids from the permission groups list', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: [
						{
							id: 'read-id',
							name: 'Workers R2 Storage Bucket Item Read',
						},
						{
							id: 'write-id',
							name: 'Workers R2 Storage Bucket Item Write',
						},
						{ id: 'other-id', name: 'Some Other Permission' },
					],
					errors: [],
				}),
			),
		)

		const ids = await resolveR2PermissionGroupIds('tok')
		expect(ids).toEqual({ readId: 'read-id', writeId: 'write-id' })
	})

	it('throws when a required group is missing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: [
						{
							id: 'read-id',
							name: 'Workers R2 Storage Bucket Item Read',
						},
					],
					errors: [],
				}),
			),
		)

		await expect(resolveR2PermissionGroupIds('tok')).rejects.toThrow(
			'missing R2 permission groups',
		)
	})
})
