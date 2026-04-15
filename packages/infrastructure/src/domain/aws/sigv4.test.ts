import { describe, expect, it } from 'vitest'

import { signSigV4Request } from './sigv4.ts'

describe('signSigV4Request', () => {
	const baseInput = {
		accessKeyId: 'AKIDEXAMPLE',
		secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
		method: 'GET',
		host: 'acct123.r2.cloudflarestorage.com',
		path: '/nextnode-state',
		query: 'list-type=2&max-keys=0',
		region: 'auto',
		service: 's3',
		payload: '',
		now: new Date('2024-06-15T12:34:56.789Z'),
	}

	it('produces a stable signature for identical inputs', () => {
		const a = signSigV4Request(baseInput)
		const b = signSigV4Request(baseInput)
		expect(a.headers.Authorization).toBe(b.headers.Authorization)
	})

	it('includes the expected signed headers and credential scope', () => {
		const signed = signSigV4Request(baseInput)
		expect(signed.headers.Authorization).toContain(
			'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20240615/auto/s3/aws4_request',
		)
		expect(signed.headers.Authorization).toContain(
			'SignedHeaders=host;x-amz-content-sha256;x-amz-date',
		)
		expect(signed.headers['x-amz-date']).toBe('20240615T123456Z')
	})

	it('builds the URL with host, path and query', () => {
		const signed = signSigV4Request(baseInput)
		expect(signed.url).toBe(
			'https://acct123.r2.cloudflarestorage.com/nextnode-state?list-type=2&max-keys=0',
		)
	})

	it('omits the "?" when query is empty', () => {
		const signed = signSigV4Request({ ...baseInput, query: '' })
		expect(signed.url).toBe(
			'https://acct123.r2.cloudflarestorage.com/nextnode-state',
		)
	})

	it('changes signature when the secret changes', () => {
		const signedA = signSigV4Request(baseInput)
		const signedB = signSigV4Request({
			...baseInput,
			secretAccessKey: 'different-secret',
		})
		expect(signedA.headers.Authorization).not.toBe(
			signedB.headers.Authorization,
		)
	})

	it('hashes the payload into x-amz-content-sha256', () => {
		const signed = signSigV4Request({ ...baseInput, payload: 'hello' })
		expect(signed.headers['x-amz-content-sha256']).toBe(
			'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
		)
	})
})
