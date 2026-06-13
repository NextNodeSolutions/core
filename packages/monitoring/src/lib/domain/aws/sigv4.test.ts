import { describe, expect, it } from 'vitest'

import { signSigV4Request } from './sigv4.ts'

const BASE = {
	accessKeyId: 'AKIDEXAMPLE',
	secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
	method: 'GET',
	host: 'acct.r2.cloudflarestorage.com',
	path: '/nextnode-state/hetzner/stylot.json',
	query: '',
	region: 'auto',
	service: 's3',
	payload: '',
	now: new Date('2026-06-13T12:00:00.000Z'),
} as const

describe('signSigV4Request', () => {
	it('produces the canonical AWS4-HMAC-SHA256 header set', () => {
		const signed = signSigV4Request(BASE)

		expect(signed.headers.Host).toBe(BASE.host)
		expect(signed.headers['x-amz-date']).toBe('20260613T120000Z')
		// Empty-payload SHA256 is a well-known constant.
		expect(signed.headers['x-amz-content-sha256']).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		)
		expect(signed.headers.Authorization).toMatch(
			/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260613\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
		)
	})

	it('is deterministic for a fixed clock', () => {
		expect(signSigV4Request(BASE)).toEqual(signSigV4Request(BASE))
	})

	it('changes the signature when the path changes', () => {
		const a = signSigV4Request(BASE)
		const b = signSigV4Request({ ...BASE, path: '/other/key.json' })
		expect(a.headers.Authorization).not.toBe(b.headers.Authorization)
	})

	it('percent-encodes special characters in the path for the canonical URI and URL', () => {
		const signed = signSigV4Request({ ...BASE, path: '/bucket/a b+c.json' })
		// Slash separators are preserved; the segment is RFC 3986-encoded
		// (space -> %20, '+' -> %2B). A raw, un-encoded path would send the
		// literal space and sign a different canonical URI.
		expect(signed.url).toBe(
			'https://acct.r2.cloudflarestorage.com/bucket/a%20b%2Bc.json',
		)
	})

	it('appends the query string to the URL when present', () => {
		const signed = signSigV4Request({
			...BASE,
			path: '/nn-backups-stylot',
			query: 'list-type=2&prefix=postgres%2F',
		})
		expect(signed.url).toBe(
			'https://acct.r2.cloudflarestorage.com/nn-backups-stylot?list-type=2&prefix=postgres%2F',
		)
	})
})
