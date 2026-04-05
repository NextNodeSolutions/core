/**
 * EmailManager facade tests
 * Tests createEmailManager() against a stub provider and stubbed renderer.
 * The provider registry and template renderer are stubbed to isolate the
 * facade's orchestration behavior (provider creation, defaultFrom resolution,
 * render failure propagation, provider delegation).
 */
import { createSpyLogger } from '@nextnode-solutions/logger/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmailManager } from '../src/email-manager.js'
import type { EmailProvider } from '../src/types/provider.js'
import type { SendResult } from '../src/types/result.js'

// Stub the provider registry — isolates the facade from real provider construction
vi.mock('../src/providers/registry.js', () => ({
	createProvider: vi.fn(),
}))

// Stub the template renderer — isolates the facade from React Email rendering
vi.mock('../src/templates/renderer.js', () => ({
	renderTemplate: vi.fn(),
}))

const { createProvider: mockCreateProvider } =
	await import('../src/providers/registry.js')
const { renderTemplate: mockRenderTemplate } =
	await import('../src/templates/renderer.js')

interface TestProps {
	name: string
}

const testTemplate = (_props: TestProps) =>
	null as unknown as React.ReactElement

const successSendResult: SendResult = {
	success: true,
	data: { id: 'msg_123', provider: 'resend', sentAt: new Date() },
}

let mockProvider: EmailProvider

beforeEach(() => {
	mockProvider = {
		name: 'resend',
		send: vi.fn().mockResolvedValue(successSendResult),
		validateConfig: vi.fn().mockResolvedValue(true),
	}
	vi.mocked(mockCreateProvider).mockResolvedValue(mockProvider)
	vi.mocked(mockRenderTemplate).mockResolvedValue({
		success: true,
		data: { html: '<p>Hello</p>', text: 'Hello' },
	})
})

describe('createEmailManager() (FR-5)', () => {
	it('delegates provider construction to createProvider with config + logger', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
		})

		expect(manager.provider).toBe(mockProvider)
		expect(mockCreateProvider).toHaveBeenCalledWith(
			'resend',
			{ apiKey: 're_test' },
			expect.anything(),
		)
	})

	it('creates the provider once at setup, not per send (PERF-2)', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		await manager.send({
			to: 'a@test.com',
			subject: 'A',
			template: testTemplate,
			props: { name: 'A' },
		})
		await manager.send({
			to: 'b@test.com',
			subject: 'B',
			template: testTemplate,
			props: { name: 'B' },
		})

		expect(mockCreateProvider).toHaveBeenCalledTimes(1)
	})
})

describe('EmailManager.send() — defaultFrom resolution (FR-9)', () => {
	it('applies defaultFrom when the message has no from', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'default@test.com',
		})

		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(mockProvider.send).toHaveBeenCalledWith(
			expect.objectContaining({ from: 'default@test.com' }),
		)
	})

	it('uses the message.from over defaultFrom when both are set', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'default@test.com',
		})

		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
			from: 'custom@test.com',
		})

		expect(mockProvider.send).toHaveBeenCalledWith(
			expect.objectContaining({ from: 'custom@test.com' }),
		)
	})

	it('returns VALIDATION_ERROR when neither defaultFrom nor message.from is set', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
		})

		const result = await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('VALIDATION_ERROR')
			expect(result.error.message).toContain('from')
		}
		expect(mockProvider.send).not.toHaveBeenCalled()
	})
})

describe('EmailManager.send() — template rendering', () => {
	it('renders the template with props then passes the html/text to the provider', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		const result = await manager.send({
			to: 'user@test.com',
			subject: 'Welcome',
			template: testTemplate,
			props: { name: 'John' },
		})

		expect(result).toEqual(successSendResult)
		expect(mockRenderTemplate).toHaveBeenCalledWith(
			testTemplate,
			{ name: 'John' },
			undefined,
		)
		expect(mockProvider.send).toHaveBeenCalledWith(
			expect.objectContaining({
				from: 'noreply@test.com',
				to: 'user@test.com',
				subject: 'Welcome',
				html: '<p>Hello</p>',
				text: 'Hello',
			}),
		)
	})

	it('forwards templateOptions to the renderer', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
			templateOptions: { pretty: true, plainText: false },
		})

		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(mockRenderTemplate).toHaveBeenCalledWith(
			testTemplate,
			{ name: 'Test' },
			{ pretty: true, plainText: false },
		)
	})

	it('returns the renderer failure without calling the provider', async () => {
		vi.mocked(mockRenderTemplate).mockResolvedValue({
			success: false,
			error: { code: 'TEMPLATE_ERROR', message: 'Render failed' },
		})

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		const result = await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('TEMPLATE_ERROR')
		}
		expect(mockProvider.send).not.toHaveBeenCalled()
	})
})

describe('EmailManager.send() — optional field forwarding', () => {
	it.each([
		{ field: 'cc', value: 'cc@test.com' },
		{ field: 'bcc', value: 'bcc@test.com' },
		{ field: 'replyTo', value: 'reply@test.com' },
		{
			field: 'attachments',
			value: [{ filename: 'f.txt', content: 'data' }],
		},
		{ field: 'headers', value: [{ name: 'X-Test', value: '1' }] },
		{ field: 'tags', value: [{ name: 'tag', value: 'v' }] },
		{ field: 'scheduledAt', value: '2026-03-01T10:00:00Z' },
	])('forwards $field to the provider', async ({ field, value }) => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
			[field]: value,
		})

		expect(mockProvider.send).toHaveBeenCalledWith(
			expect.objectContaining({ [field]: value }),
		)
	})
})

describe('EmailManager.validateConfig() (FR-10)', () => {
	it.each([
		{ providerResult: true, expected: true },
		{ providerResult: false, expected: false },
	])(
		'delegates to provider.validateConfig() and returns $expected',
		async ({ providerResult, expected }) => {
			vi.mocked(mockProvider.validateConfig).mockResolvedValue(
				providerResult,
			)

			const manager = await createEmailManager({
				provider: 'resend',
				providerConfig: { apiKey: 're_test' },
			})

			await expect(manager.validateConfig()).resolves.toBe(expected)
			expect(mockProvider.validateConfig).toHaveBeenCalledOnce()
		},
	)
})

describe('EmailManager — logger injection', () => {
	it('forwards an "Email sent successfully" info log with the message id when send succeeds', async () => {
		const spy = createSpyLogger()

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
			logger: spy,
		})
		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		const infoCalls = spy.getCallsByLevel('info')
		expect(infoCalls).toHaveLength(1)
		expect(infoCalls[0]?.message).toBe('Email sent successfully')
		expect(infoCalls[0]?.object).toEqual({
			details: { messageId: 'msg_123' },
		})
	})

	it('forwards an "Email send failed" error log when the provider fails', async () => {
		vi.mocked(mockProvider.send).mockResolvedValue({
			success: false,
			error: {
				code: 'PROVIDER_ERROR',
				message: 'upstream down',
				provider: 'resend',
			},
		})
		const spy = createSpyLogger()

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
			logger: spy,
		})
		await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(spy.wasCalledWithLevel('error', 'Email send failed')).toBe(true)
	})

	it('passes a PROVIDER-scoped child logger to createProvider', async () => {
		const spy = createSpyLogger()

		await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			logger: spy,
		})

		const childLogger = vi.mocked(mockCreateProvider).mock.calls[0]?.[2]
		expect(childLogger).toBeDefined()
		// The child logger should have access to the same underlying calls array
		childLogger?.info('marker-from-child')
		expect(spy.wasCalledWith('marker-from-child')).toBe(true)
		expect(spy.getLastCall()?.scope).toBe('PROVIDER')
	})

	it('works without a logger (silent default)', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		const result = await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
		})

		expect(result.success).toBe(true)
	})
})
