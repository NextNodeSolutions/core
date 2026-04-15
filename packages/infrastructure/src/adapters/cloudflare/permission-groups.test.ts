import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveR2PermissionGroupIds } from './permission-groups.ts'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

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
