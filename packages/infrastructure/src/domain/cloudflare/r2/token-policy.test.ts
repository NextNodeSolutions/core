import { describe, expect, it } from 'vitest'

import { buildR2TokenPolicy } from './token-policy.ts'

const BASE = {
	tokenName: 'nextnode-r2',
	accountId: 'acct123',
	permissions: { readId: 'read-id', writeId: 'write-id' },
}

describe('buildR2TokenPolicy', () => {
	it('emits the token name and read/write permission groups', () => {
		const body = buildR2TokenPolicy({
			...BASE,
			bucketNames: ['nextnode-state'],
		})
		expect(body.name).toBe('nextnode-r2')
		expect(body.policies.at(0)!.permission_groups).toEqual([
			{ id: 'read-id' },
			{ id: 'write-id' },
		])
		expect(body.policies.at(0)!.effect).toBe('allow')
	})

	it('maps each bucket to the CF resource key with full access', () => {
		const body = buildR2TokenPolicy({
			...BASE,
			bucketNames: ['nextnode-state', 'nextnode-certs'],
		})
		expect(body.policies.at(0)!.resources).toEqual({
			'com.cloudflare.edge.r2.bucket.acct123_default_nextnode-state': '*',
			'com.cloudflare.edge.r2.bucket.acct123_default_nextnode-certs': '*',
		})
	})

	it('rejects an empty bucket list', () => {
		expect(() => buildR2TokenPolicy({ ...BASE, bucketNames: [] })).toThrow(
			'bucketNames must not be empty',
		)
	})
})
