import { describe, expect, it } from 'vitest'

import {
	bucketResourceKey,
	computeR2Endpoint,
	computeR2Host,
} from './addressing.ts'

describe('computeR2Endpoint', () => {
	it('returns the https endpoint URL', () => {
		expect(computeR2Endpoint('acct123')).toBe(
			'https://acct123.r2.cloudflarestorage.com',
		)
	})
})

describe('computeR2Host', () => {
	it('returns the host without scheme', () => {
		expect(computeR2Host('acct123')).toBe(
			'acct123.r2.cloudflarestorage.com',
		)
	})
})

describe('bucketResourceKey', () => {
	it('formats the CF IAM resource identifier', () => {
		expect(bucketResourceKey('acct123', 'nextnode-state')).toBe(
			'com.cloudflare.edge.r2.bucket.acct123_default_nextnode-state',
		)
	})
})
