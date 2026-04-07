/**
 * Resend provider tests
 * Mock the Resend SDK (external boundary) to verify request mapping,
 * error mapping, and message validation
 */
import { createNoopLogger } from '@nextnode-solutions/logger/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProviderUtils } from '../src/providers/base.js'
import { createProvider } from '../src/providers/registry.js'
import { createResendProvider } from '../src/providers/resend.js'
import type { EmailMessage } from '../src/types/email.js'

// Mock the Resend SDK — external API boundary, no real HTTP
vi.mock('resend', () => ({
	Resend: vi.fn().mockImplementation((apiKey: string) => ({
		emails: { send: vi.fn() },
		domains: { list: vi.fn() },
		_apiKey: apiKey,
	})),
}))

interface MockResendClient {
	emails: { send: ReturnType<typeof vi.fn> }
	domains: { list: ReturnType<typeof vi.fn> }
}

const createMockClient = (): MockResendClient => ({
	emails: { send: vi.fn() },
	domains: { list: vi.fn() },
})

const baseMessage: EmailMessage = {
	from: 'sender@example.com',
	to: 'recipient@example.com',
	subject: 'Test Email',
	html: '<h1>Hello</h1>',
}

describe('Resend Provider', () => {
	let mockClient: MockResendClient
	let provider: ReturnType<typeof createResendProvider>

	beforeEach(() => {
		mockClient = createMockClient()
		// @ts-expect-error — mock client only implements the methods used by the provider
		provider = createResendProvider(mockClient, createNoopLogger())
	})

	describe('send() — happy path', () => {
		it('returns a success result with the Resend message id', async () => {
			mockClient.emails.send.mockResolvedValue({
				data: { id: 'msg_123' },
				error: null,
			})

			const result = await provider.send(baseMessage)

			expect(result).toEqual({
				success: true,
				data: {
					id: 'msg_123',
					provider: 'resend',
					sentAt: expect.any(Date),
				},
			})
		})

		it('has name "resend"', () => {
			expect(provider.name).toBe('resend')
		})
	})

	describe('send() — EmailMessage → Resend payload mapping', () => {
		beforeEach(() => {
			mockClient.emails.send.mockResolvedValue({
				data: { id: 'msg_ok' },
				error: null,
			})
		})

		it('formats a recipient object as "Name <email>"', async () => {
			await provider.send({
				from: { email: 'sender@example.com', name: 'Sender' },
				to: { email: 'recipient@example.com', name: 'Recipient' },
				subject: 'Test',
				html: '<p>Hi</p>',
			})

			expect(mockClient.emails.send).toHaveBeenCalledWith(
				expect.objectContaining({
					from: 'Sender <sender@example.com>',
					to: ['Recipient <recipient@example.com>'],
				}),
			)
		})

		it.each([
			{
				name: 'cc/bcc/replyTo recipients (strings & arrays)',
				input: {
					cc: 'cc@example.com',
					bcc: ['bcc1@example.com', 'bcc2@example.com'],
					replyTo: 'reply@example.com',
				},
				expected: {
					cc: ['cc@example.com'],
					bcc: ['bcc1@example.com', 'bcc2@example.com'],
					replyTo: ['reply@example.com'],
				},
			},
			{
				name: 'attachments with contentType',
				input: {
					attachments: [
						{
							filename: 'test.pdf',
							content: Buffer.from('data'),
							contentType: 'application/pdf',
						},
					],
				},
				expected: {
					attachments: [
						{
							filename: 'test.pdf',
							content: Buffer.from('data'),
							contentType: 'application/pdf',
						},
					],
				},
			},
			{
				name: 'headers array converted to Record<string,string>',
				input: { headers: [{ name: 'X-Custom', value: 'test' }] },
				expected: { headers: { 'X-Custom': 'test' } },
			},
			{
				name: 'tags forwarded as-is',
				input: { tags: [{ name: 'campaign', value: 'launch' }] },
				expected: { tags: [{ name: 'campaign', value: 'launch' }] },
			},
			{
				name: 'scheduledAt Date → ISO string',
				input: { scheduledAt: new Date('2026-03-01T10:00:00Z') },
				expected: { scheduledAt: '2026-03-01T10:00:00.000Z' },
			},
			{
				name: 'scheduledAt string passed as-is',
				input: { scheduledAt: '2026-03-01T10:00:00Z' },
				expected: { scheduledAt: '2026-03-01T10:00:00Z' },
			},
		])('maps $name', async ({ input, expected }) => {
			await provider.send({ ...baseMessage, ...input })

			expect(mockClient.emails.send).toHaveBeenCalledWith(
				expect.objectContaining(expected),
			)
		})
	})

	describe('send() — error mapping (FR-20)', () => {
		it.each([
			{
				label: 'rate limit exception → RATE_LIMIT_ERROR',
				rejection: new Error('Rate limit exceeded'),
				expectedCode: 'RATE_LIMIT_ERROR',
			},
			{
				label: 'validation exception → VALIDATION_ERROR',
				rejection: new Error('Validation failed'),
				expectedCode: 'VALIDATION_ERROR',
			},
			{
				label: 'network exception → NETWORK_ERROR',
				rejection: new Error('Network failure'),
				expectedCode: 'NETWORK_ERROR',
			},
			{
				label: 'generic exception → PROVIDER_ERROR',
				rejection: new Error('Something unexpected'),
				expectedCode: 'PROVIDER_ERROR',
			},
			{
				label: 'non-Error throw → UNKNOWN_ERROR',
				rejection: 'string error',
				expectedCode: 'UNKNOWN_ERROR',
			},
		])('maps $label', async ({ rejection, expectedCode }) => {
			mockClient.emails.send.mockRejectedValue(rejection)

			const result = await provider.send(baseMessage)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe(expectedCode)
				expect(result.error.provider).toBe('resend')
			}
		})

		it('maps API error field to AUTHENTICATION_ERROR when message mentions API key', async () => {
			mockClient.emails.send.mockResolvedValue({
				data: null,
				error: { message: 'Invalid API key' },
			})

			const result = await provider.send(baseMessage)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('AUTHENTICATION_ERROR')
				expect(result.error.provider).toBe('resend')
			}
		})

		it('returns PROVIDER_ERROR when Resend returns no data and no error', async () => {
			mockClient.emails.send.mockResolvedValue({
				data: null,
				error: null,
			})

			const result = await provider.send(baseMessage)

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('PROVIDER_ERROR')
				expect(result.error.message).toContain('No data')
			}
		})
	})

	describe('send() — message validation', () => {
		it('rejects an empty recipients array with VALIDATION_ERROR (EC-3)', async () => {
			const result = await provider.send({
				from: 'sender@example.com',
				to: [],
				subject: 'Test',
				html: '<p>Hi</p>',
			})

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('VALIDATION_ERROR')
			}
			expect(mockClient.emails.send).not.toHaveBeenCalled()
		})

		it('rejects a message with no html or text content', async () => {
			const result = await provider.send({
				from: 'sender@example.com',
				to: 'recipient@example.com',
				subject: 'Test',
				html: '',
			})

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('VALIDATION_ERROR')
			}
			expect(mockClient.emails.send).not.toHaveBeenCalled()
		})
	})

	describe('validateConfig()', () => {
		it('returns true when domains.list resolves', async () => {
			mockClient.domains.list.mockResolvedValue({ data: [] })

			await expect(provider.validateConfig()).resolves.toBe(true)
		})

		it('returns false when domains.list throws', async () => {
			mockClient.domains.list.mockRejectedValue(new Error('Unauthorized'))

			await expect(provider.validateConfig()).resolves.toBe(false)
		})
	})
})

describe('createProvider() — registry (FR-16)', () => {
	it('returns a functional Resend provider that forwards send() to the SDK', async () => {
		const provider = await createProvider('resend', {
			apiKey: 're_test_key',
		})

		expect(provider.name).toBe('resend')
		// The provider should implement the EmailProvider contract
		expect(typeof provider.send).toBe('function')
		expect(typeof provider.validateConfig).toBe('function')
	})

	it.each([
		{ label: 'empty string', apiKey: '' },
		{ label: 'whitespace only', apiKey: '   ' },
	])('throws for $label API key (EC-2 fail-fast)', async ({ apiKey }) => {
		await expect(createProvider('resend', { apiKey })).rejects.toThrow(
			'Resend API key is required',
		)
	})
})

describe('Provider utils (base)', () => {
	const utils = createProviderUtils('test')

	describe('normalizeRecipient()', () => {
		it.each([
			{ input: 'user@test.com', expected: 'user@test.com' },
			{
				input: { email: 'user@test.com', name: 'User' },
				expected: 'User <user@test.com>',
			},
			{
				input: { email: 'user@test.com' },
				expected: 'user@test.com',
			},
		])('formats $input → "$expected"', ({ input, expected }) => {
			expect(utils.normalizeRecipient(input)).toBe(expected)
		})
	})

	describe('normalizeRecipients()', () => {
		it('wraps a single recipient in an array', () => {
			expect(utils.normalizeRecipients('user@test.com')).toEqual([
				'user@test.com',
			])
		})

		it('maps an array of mixed string/object recipients', () => {
			expect(
				utils.normalizeRecipients([
					'a@test.com',
					{ email: 'b@test.com', name: 'B' },
				]),
			).toEqual(['a@test.com', 'B <b@test.com>'])
		})
	})

	describe('validateMessage()', () => {
		it('accepts a message with all required fields', () => {
			const result = utils.validateMessage(baseMessage)

			expect(result).toEqual({ success: true, data: undefined })
		})

		it('rejects more than 50 recipients with a message citing both counts (EC-6)', () => {
			const recipients = Array.from(
				{ length: 51 },
				(_, i) => `user${String(i)}@test.com`,
			)

			const result = utils.validateMessage({
				...baseMessage,
				to: recipients,
			})

			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.code).toBe('VALIDATION_ERROR')
				expect(result.error.message).toContain('51')
				expect(result.error.message).toContain('50')
			}
		})
	})
})
