/**
 * Resend email provider
 * Implementation of EmailProvider interface for Resend
 */

import { fail } from '../types/result.js'

import { createProviderUtils } from './base.js'

import type { Logger } from '@nextnode-solutions/logger'
import type { Attachment, CreateEmailOptions, Resend } from 'resend'
import type { EmailMessage } from '../types/email.js'
import type { EmailProvider } from '../types/provider.js'
import type { EmailError, SendResult } from '../types/result.js'

const HTTP_VALIDATION_ERROR = 422
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_RATE_LIMIT = 429

/**
 * Classification rules for Resend error messages (FR-20).
 * First matching rule wins. `message: null` keeps the original error message.
 */
const RESEND_ERROR_RULES: ReadonlyArray<{
	needles: string[]
	code: EmailError['code']
	message: string | null
}> = [
	{
		needles: ['rate limit', String(HTTP_RATE_LIMIT)],
		code: 'RATE_LIMIT_ERROR',
		message: 'Rate limit exceeded',
	},
	{
		needles: [
			'unauthorized',
			'api key',
			String(HTTP_UNAUTHORIZED),
			String(HTTP_FORBIDDEN),
		],
		code: 'AUTHENTICATION_ERROR',
		message: 'Invalid API key or unauthorized',
	},
	{
		needles: ['validation', String(HTTP_VALIDATION_ERROR)],
		code: 'VALIDATION_ERROR',
		message: null,
	},
	{
		needles: ['network', 'econnrefused', 'timeout', 'fetch'],
		code: 'NETWORK_ERROR',
		message: null,
	},
]

/**
 * Map Resend API errors to EmailError (FR-20)
 */
const mapResendError = (error: unknown): EmailError => {
	if (!(error instanceof Error)) {
		return {
			code: 'UNKNOWN_ERROR',
			message: 'An unknown error occurred',
			provider: 'resend',
			originalError: error,
		}
	}

	const message = error.message.toLowerCase()
	const matched = RESEND_ERROR_RULES.find(rule =>
		rule.needles.some(needle => message.includes(needle)),
	)

	return {
		code: matched?.code ?? 'PROVIDER_ERROR',
		message: matched?.message ?? error.message,
		provider: 'resend',
		originalError: error,
	}
}

/**
 * Map optional content fields (text, attachments)
 */
const mapOptionalContent = (
	message: EmailMessage,
): { text?: string; attachments?: Attachment[] } => ({
	...(message.text && { text: message.text }),
	...(message.attachments && {
		attachments: message.attachments.map(
			(a): Attachment => ({
				filename: a.filename,
				content: a.content,
				...(a.contentType && { contentType: a.contentType }),
			}),
		),
	}),
})

/**
 * Map optional metadata (headers, tags, scheduledAt)
 */
const mapOptionalMetadata = (
	message: EmailMessage,
): {
	headers?: Record<string, string>
	tags?: Array<{ name: string; value: string }>
	scheduledAt?: string
} => ({
	...(message.headers && {
		headers: Object.fromEntries(
			message.headers.map(h => [h.name, h.value]),
		),
	}),
	...(message.tags && {
		tags: message.tags.map(t => ({
			name: t.name,
			value: t.value,
		})),
	}),
	...(message.scheduledAt && {
		scheduledAt:
			message.scheduledAt instanceof Date
				? message.scheduledAt.toISOString()
				: message.scheduledAt,
	}),
})

type ProviderUtils = ReturnType<typeof createProviderUtils>

/**
 * Map optional recipients (cc, bcc, replyTo)
 */
const mapOptionalRecipients = (
	message: EmailMessage,
	utils: ProviderUtils,
): { cc?: string[]; bcc?: string[]; replyTo?: string[] } => ({
	...(message.cc && {
		cc: utils.normalizeRecipients(message.cc),
	}),
	...(message.bcc && {
		bcc: utils.normalizeRecipients(message.bcc),
	}),
	...(message.replyTo && {
		replyTo: utils.normalizeRecipients(message.replyTo),
	}),
})

/**
 * Map EmailMessage to Resend payload
 */
const mapToResendPayload = (
	message: EmailMessage,
	utils: ProviderUtils,
): CreateEmailOptions => ({
	from: utils.normalizeRecipient(message.from),
	to: utils.normalizeRecipients(message.to),
	subject: message.subject,
	html: message.html,
	...mapOptionalRecipients(message, utils),
	...mapOptionalContent(message),
	...mapOptionalMetadata(message),
})

const errorMessageOf = (error: unknown): string =>
	error instanceof Error ? error.message : 'unknown'

/**
 * Send an email through the Resend client (FR-20)
 */
const sendViaResend = async (
	deps: { resendClient: Resend; logger: Logger; utils: ProviderUtils },
	message: EmailMessage,
): Promise<SendResult> => {
	const { resendClient, logger, utils } = deps

	const validation = utils.validateMessage(message)
	if (!validation.success) {
		return validation
	}

	logger.debug('Sending email via Resend', {
		details: {
			recipientCount: Array.isArray(message.to) ? message.to.length : 1,
		},
	})

	try {
		const payload = mapToResendPayload(message, utils)
		const { data, error } = await resendClient.emails.send(payload)

		if (error) {
			logger.error('Resend API returned error', {
				details: { errorMessage: error.message },
			})
			return fail(mapResendError(new Error(error.message)))
		}

		if (!data) {
			logger.error('No data returned from Resend')
			return fail({
				code: 'PROVIDER_ERROR',
				message: 'No data returned from Resend',
				provider: 'resend',
			})
		}

		logger.info('Email sent successfully', {
			details: { messageId: data.id },
		})

		return {
			success: true,
			data: { id: data.id, provider: 'resend', sentAt: new Date() },
		}
	} catch (error) {
		logger.error('Resend send failed', {
			details: { error: errorMessageOf(error) },
		})
		return fail(mapResendError(error))
	}
}

/**
 * Create Resend email provider
 *
 * @param resendClient - Pre-configured Resend SDK client
 * @param logger - Logger for provider-level observability
 */
export const createResendProvider = (
	resendClient: Resend,
	logger: Logger,
): EmailProvider => {
	const utils = createProviderUtils('resend')

	return {
		name: 'resend',

		send: (message: EmailMessage): Promise<SendResult> =>
			sendViaResend({ resendClient, logger, utils }, message),

		async validateConfig(): Promise<boolean> {
			try {
				await resendClient.domains.list()
				return true
			} catch (error) {
				logger.error('Resend validateConfig failed', {
					details: { error: errorMessageOf(error) },
				})
				return false
			}
		},
	}
}
