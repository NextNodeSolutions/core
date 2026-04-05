/**
 * Type-level tests for @nextnode-solutions/email-manager
 * Validates that types are correct at compile time and runtime
 */
import { describe, expect, it } from 'vitest'

import type {
	EmailAttachment,
	EmailHeader,
	EmailMessage,
	EmailRecipient,
	EmailTag,
	RenderedTemplate,
	TemplatedEmailMessage,
	TemplateRenderOptions,
} from '../src/types/email.js'
import type {
	EmailProvider,
	ProviderConfigMap,
	ResendProviderConfig,
} from '../src/types/provider.js'
import type {
	EmailErrorCode,
	Result,
	SendSuccess,
} from '../src/types/result.js'
import { emailError, emailFail, fail } from '../src/types/result.js'

describe('FR-21: Result pattern', () => {
	it('success result has data property', () => {
		const result: Result<string> = { success: true, data: 'ok' }
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.data).toBe('ok')
		}
	})

	it('failure result has error property', () => {
		const result: Result<string> = {
			success: false,
			error: new Error('fail'),
		}
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.message).toBe('fail')
		}
	})

	it('fail() creates a failure result', () => {
		const result = fail(new Error('test'))
		expect(result.success).toBe(false)
		expect(result.error.message).toBe('test')
	})
})

describe('FR-22: SendResult and EmailError', () => {
	it('emailError creates an EmailError object', () => {
		const err = emailError('VALIDATION_ERROR', 'bad input')
		expect(err.code).toBe('VALIDATION_ERROR')
		expect(err.message).toBe('bad input')
	})

	it('emailError includes optional fields', () => {
		const err = emailError('PROVIDER_ERROR', 'api fail', {
			provider: 'resend',
			originalError: new Error('original'),
		})
		expect(err.provider).toBe('resend')
		expect(err.originalError).toBeInstanceOf(Error)
	})

	it('emailFail creates a failure SendResult', () => {
		const result = emailFail('AUTHENTICATION_ERROR', 'bad key')
		expect(result.success).toBe(false)
		expect(result.error.code).toBe('AUTHENTICATION_ERROR')
	})

	it('all EmailErrorCode values are valid', () => {
		const codes: EmailErrorCode[] = [
			'VALIDATION_ERROR',
			'AUTHENTICATION_ERROR',
			'RATE_LIMIT_ERROR',
			'PROVIDER_ERROR',
			'NETWORK_ERROR',
			'TEMPLATE_ERROR',
			'UNKNOWN_ERROR',
		]
		expect(codes).toHaveLength(7)
	})

	it('SendSuccess has required fields', () => {
		const success: SendSuccess = {
			id: 'msg_123',
			provider: 'resend',
			sentAt: new Date(),
		}
		expect(success.id).toBe('msg_123')
		expect(success.provider).toBe('resend')
		expect(success.sentAt).toBeInstanceOf(Date)
	})
})

describe('FR-23: EmailRecipient', () => {
	it('accepts string format', () => {
		const recipient: EmailRecipient = 'user@example.com'
		expect(recipient).toBe('user@example.com')
	})

	it('accepts object format', () => {
		const recipient: EmailRecipient = {
			email: 'user@example.com',
			name: 'User',
		}
		expect(recipient).toEqual({
			email: 'user@example.com',
			name: 'User',
		})
	})

	it('accepts object without name', () => {
		const recipient: EmailRecipient = { email: 'user@example.com' }
		expect(recipient).toEqual({ email: 'user@example.com' })
	})
})

describe('FR-24: EmailAttachment', () => {
	it('accepts Buffer content', () => {
		const attachment: EmailAttachment = {
			filename: 'test.pdf',
			content: Buffer.from('data'),
		}
		expect(attachment.filename).toBe('test.pdf')
	})

	it('accepts string content', () => {
		const attachment: EmailAttachment = {
			filename: 'test.txt',
			content: 'text data',
			contentType: 'text/plain',
		}
		expect(attachment.contentType).toBe('text/plain')
	})
})

describe('FR-25: EmailHeader and EmailTag', () => {
	it('EmailHeader has name and value', () => {
		const header: EmailHeader = {
			name: 'X-Custom',
			value: 'test',
		}
		expect(header.name).toBe('X-Custom')
	})

	it('EmailTag has name and value', () => {
		const tag: EmailTag = { name: 'campaign', value: 'launch' }
		expect(tag.name).toBe('campaign')
	})
})

describe('FR-15: EmailProvider interface', () => {
	it('provider shape is valid with required fields', () => {
		const mockProvider: EmailProvider = {
			name: 'test',
			send: async () => ({
				success: true,
				data: { id: '1', provider: 'test', sentAt: new Date() },
			}),
			validateConfig: async () => true,
		}
		expect(mockProvider.name).toBe('test')
	})
})

describe('FR-17: ProviderConfigMap', () => {
	it('maps resend to ResendProviderConfig', () => {
		const config: ProviderConfigMap['resend'] = {
			apiKey: 'test-key',
		}
		expect(config.apiKey).toBe('test-key')
	})
})

describe('FR-18: ResendProviderConfig', () => {
	it('requires apiKey', () => {
		const config: ResendProviderConfig = { apiKey: 're_123' }
		expect(config.apiKey).toBe('re_123')
	})
})

describe('FR-12: TemplateRenderOptions', () => {
	it('all options are optional', () => {
		const opts: TemplateRenderOptions = {}
		expect(opts.pretty).toBeUndefined()
		expect(opts.plainText).toBeUndefined()
	})

	it('accepts all options', () => {
		const opts: TemplateRenderOptions = {
			pretty: true,
			plainText: false,
		}
		expect(opts.pretty).toBe(true)
		expect(opts.plainText).toBe(false)
	})
})

describe('EmailMessage (post-render)', () => {
	it('requires from, to, subject, html', () => {
		const msg: EmailMessage = {
			from: 'sender@test.com',
			to: 'recipient@test.com',
			subject: 'Test',
			html: '<p>Hello</p>',
		}
		expect(msg.html).toBe('<p>Hello</p>')
	})

	it('supports all optional fields', () => {
		const msg: EmailMessage = {
			from: { email: 'sender@test.com', name: 'Sender' },
			to: ['a@test.com', { email: 'b@test.com', name: 'B' }],
			subject: 'Test',
			html: '<p>Hello</p>',
			text: 'Hello',
			cc: 'cc@test.com',
			bcc: ['bcc@test.com'],
			replyTo: 'reply@test.com',
			attachments: [{ filename: 'f.txt', content: 'data' }],
			headers: [{ name: 'X-Test', value: '1' }],
			tags: [{ name: 'tag', value: 'v' }],
			scheduledAt: new Date().toISOString(),
		}
		expect(msg.to).toHaveLength(2)
	})
})

describe('TemplatedEmailMessage (pre-render)', () => {
	it('has template and props instead of html/text', () => {
		interface TestProps {
			name: string
		}
		const msg: TemplatedEmailMessage<TestProps> = {
			to: 'user@test.com',
			subject: 'Welcome',
			template: (_props: TestProps) =>
				null as unknown as React.ReactElement,
			props: { name: 'John' },
		}
		expect(msg.props.name).toBe('John')
	})
})

describe('RenderedTemplate', () => {
	it('has html and optional text', () => {
		const rendered: RenderedTemplate = {
			html: '<p>Hello</p>',
			text: 'Hello',
		}
		expect(rendered.html).toBe('<p>Hello</p>')
	})
})
