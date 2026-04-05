/**
 * Email Manager facade integration tests
 * Tests createEmailManager() with mock provider
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmailManager } from '../src/email-manager.js'
import type { EmailProvider } from '../src/types/provider.js'
import type { SendResult } from '../src/types/result.js'

// Mock the provider registry to return our mock provider
vi.mock('../src/providers/registry.js', () => ({
	createProvider: vi.fn(),
}))

// Mock the template renderer
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

describe('createEmailManager (FR-5)', () => {
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

	it('creates an email manager with provider', async () => {
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

	it('exposes provider as readonly', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
		})

		expect(manager.provider.name).toBe('resend')
	})
})

describe('EmailManager.send() (FR-7, FR-9)', () => {
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

	it('sends email with template', async () => {
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

		expect(result.success).toBe(true)
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

	it('applies defaultFrom when from is not provided (FR-9)', async () => {
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
			expect.objectContaining({
				from: 'default@test.com',
			}),
		)
	})

	it('uses message from over defaultFrom', async () => {
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
			expect.objectContaining({
				from: 'custom@test.com',
			}),
		)
	})

	it('returns VALIDATION_ERROR when no from address', async () => {
		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			// No defaultFrom
		})

		const result = await manager.send({
			to: 'user@test.com',
			subject: 'Test',
			template: testTemplate,
			props: { name: 'Test' },
			// No from
		})

		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.code).toBe('VALIDATION_ERROR')
			expect(result.error.message).toContain('from')
		}
	})

	it('returns TEMPLATE_ERROR on render failure', async () => {
		vi.mocked(mockRenderTemplate).mockResolvedValue({
			success: false,
			error: {
				code: 'TEMPLATE_ERROR',
				message: 'Render failed',
			},
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
		// Should not call provider.send
		expect(mockProvider.send).not.toHaveBeenCalled()
	})

	it('passes templateOptions to renderTemplate', async () => {
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

	it('passes all optional fields to provider', async () => {
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
			cc: 'cc@test.com',
			bcc: 'bcc@test.com',
			replyTo: 'reply@test.com',
			attachments: [{ filename: 'f.txt', content: 'data' }],
			headers: [{ name: 'X-Test', value: '1' }],
			tags: [{ name: 'tag', value: 'v' }],
			scheduledAt: '2026-03-01T10:00:00Z',
		})

		expect(mockProvider.send).toHaveBeenCalledWith(
			expect.objectContaining({
				cc: 'cc@test.com',
				bcc: 'bcc@test.com',
				replyTo: 'reply@test.com',
				attachments: [{ filename: 'f.txt', content: 'data' }],
				headers: [{ name: 'X-Test', value: '1' }],
				tags: [{ name: 'tag', value: 'v' }],
				scheduledAt: '2026-03-01T10:00:00Z',
			}),
		)
	})
})

describe('EmailManager.validateConfig() (FR-10)', () => {
	it('delegates to provider validateConfig', async () => {
		const mockProvider: EmailProvider = {
			name: 'resend',
			send: vi.fn(),
			validateConfig: vi.fn().mockResolvedValue(true),
		}
		vi.mocked(mockCreateProvider).mockResolvedValue(mockProvider)

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
		})

		const result = await manager.validateConfig()

		expect(result).toBe(true)
		expect(mockProvider.validateConfig).toHaveBeenCalled()
	})

	it('returns false when provider validation fails', async () => {
		const mockProvider: EmailProvider = {
			name: 'resend',
			send: vi.fn(),
			validateConfig: vi.fn().mockResolvedValue(false),
		}
		vi.mocked(mockCreateProvider).mockResolvedValue(mockProvider)

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
		})

		const result = await manager.validateConfig()

		expect(result).toBe(false)
	})
})

describe('PERF-2: Lazy provider initialization', () => {
	it('creates provider once at initialization, not per send', async () => {
		const mockProvider: EmailProvider = {
			name: 'resend',
			send: vi.fn().mockResolvedValue(successSendResult),
			validateConfig: vi.fn().mockResolvedValue(true),
		}
		vi.mocked(mockCreateProvider).mockResolvedValue(mockProvider)
		vi.mocked(mockRenderTemplate).mockResolvedValue({
			success: true,
			data: { html: '<p>Hello</p>', text: 'Hello' },
		})

		const manager = await createEmailManager({
			provider: 'resend',
			providerConfig: { apiKey: 're_test' },
			defaultFrom: 'noreply@test.com',
		})

		// createProvider called once at creation
		expect(mockCreateProvider).toHaveBeenCalledTimes(1)

		// Send twice
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

		// Still only called once
		expect(mockCreateProvider).toHaveBeenCalledTimes(1)
	})
})
