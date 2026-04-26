import type { MockResponse } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { verifyR2Credentials } from './verify-credentials.ts'

function status(code: number, body = ''): MockResponse {
	return {
		ok: code >= 200 && code < 300,
		status: code,
		text: () => Promise.resolve(body),
		json: () => Promise.resolve({}),
	}
}

const INPUT = {
	accountId: 'acct',
	accessKeyId: 'ak',
	secretAccessKey: 'sk',
	bucketName: 'nextnode-state',
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('verifyR2Credentials', () => {
	it('returns {valid:true} on HTTP 200', async () => {
		const fetchMock = vi.fn().mockResolvedValue(status(200))
		vi.stubGlobal('fetch', fetchMock)

		await expect(verifyR2Credentials(INPUT)).resolves.toEqual({
			valid: true,
		})
		const call = fetchMock.mock.calls[0]
		if (!call) throw new Error('expected fetch call')
		expect(call[0]).toBe(
			'https://acct.r2.cloudflarestorage.com/nextnode-state?list-type=2&max-keys=0',
		)
		expect(call[1].headers.Authorization).toContain(
			'AWS4-HMAC-SHA256 Credential=ak/',
		)
	})

	it('returns {valid:false, status:401, body} on 401', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(status(401, 'InvalidAccessKeyId')),
		)
		await expect(verifyR2Credentials(INPUT)).resolves.toEqual({
			valid: false,
			status: 401,
			body: 'InvalidAccessKeyId',
		})
	})

	it('returns {valid:false, status:403, body} on 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(status(403, 'SignatureDoesNotMatch')),
		)
		await expect(verifyR2Credentials(INPUT)).resolves.toEqual({
			valid: false,
			status: 403,
			body: 'SignatureDoesNotMatch',
		})
	})

	it('returns {valid:false} on 400 (malformed creds)', async () => {
		const body =
			'<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Credential access key has length 33, should be 32</Message></Error>'
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(400, body)))

		await expect(verifyR2Credentials(INPUT)).resolves.toEqual({
			valid: false,
			status: 400,
			body,
		})
	})

	it('throws on 500', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(500, 'boom')))
		await expect(verifyR2Credentials(INPUT)).rejects.toThrow(
			'returned 500: boom',
		)
	})
})
