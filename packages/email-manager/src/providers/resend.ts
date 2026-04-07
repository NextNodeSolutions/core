/**
 * Resend email provider
 * Implementation of EmailProvider interface for Resend
 */

import type { Logger } from '@nextnode-solutions/logger'
import type { Attachment, CreateEmailOptions, Resend } from 'resend'

import type { EmailMessage } from '../types/email.js'
import type { EmailProvider } from '../types/provider.js'
import type { EmailError, SendResult } from '../types/result.js'
import { fail } from '../types/result.js'

import { createProviderUtils } from './base.js'

const HTTP_VALIDATION_ERROR = 422
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_RATE_LIMIT = 429

/**
 * Map Resend API errors to EmailError (FR-20)
 */
const mapResendError = (error: unknown): EmailError => {
	if (error instanceof Error) {
		const message = error.message.toLowerCase()

		// Check for HTTP status code patterns
		if (
			message.includes('rate limit') ||
			message.includes(String(HTTP_RATE_LIMIT))
		) {
			return {
				code: 'RATE_LIMIT_ERROR',
				message: 'Rate limit exceeded',
				provider: 'resend',
				originalError: error,
			}
		}

		if (
			message.includes('unauthorized') ||
			message.includes('api key') ||
			message.includes(String(HTTP_UNAUTHORIZED)) ||
			message.includes(String(HTTP_FORBIDDEN))
		) {
			return {
				code: 'AUTHENTICATION_ERROR',
				message: 'Invalid API key or unauthorized',
				provider: 'resend',
				originalError: error,
			}
		}

		if (
			message.includes('validation') ||
			message.includes(String(HTTP_VALIDATION_ERROR))
		) {
			return {
				code: 'VALIDATION_ERROR',
				message: error.message,
				provider: 'resend',
				originalError: error,
			}
		}

		// Check for network errors
		if (
			message.includes('network') ||
			message.includes('econnrefused') ||
			message.includes('timeout') ||
			message.includes('fetch')
		) {
			return {
				code: 'NETWORK_ERROR',
				message: error.message,
				provider: 'resend',
				originalError: error,
			}
		}

		return {
			code: 'PROVIDER_ERROR',
			message: error.message,
			provider: 'resend',
			originalError: error,
		}
	}

	return {
		code: 'UNKNOWN_ERROR',
		message: 'An unknown error occurred',
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

	/**
	 * Map optional recipients (cc, bcc, replyTo)
	 */
	const mapOptionalRecipients = (
		message: EmailMessage,
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
	const mapToResendPayload = (message: EmailMessage): CreateEmailOptions => ({
		from: utils.normalizeRecipient(message.from),
		to: utils.normalizeRecipients(message.to),
		subject: message.subject,
		html: message.html,
		...mapOptionalRecipients(message),
		...mapOptionalContent(message),
		...mapOptionalMetadata(message),
	})

	return {
		name: 'resend',

		async send(message: EmailMessage): Promise<SendResult> {
			const validation = utils.validateMessage(message)
			if (!validation.success) {
				return validation
			}

			logger.debug('Sending email via Resend', {
				details: {
					recipientCount: Array.isArray(message.to)
						? message.to.length
						: 1,
				},
			})

			try {
				const payload = mapToResendPayload(message)
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
					data: {
						id: data.id,
						provider: 'resend',
						sentAt: new Date(),
					},
				}
			} catch (error) {
				logger.error('Resend send failed', {
					details: {
						error:
							error instanceof Error ? error.message : 'unknown',
					},
				})
				return fail(mapResendError(error))
			}
		},

		async validateConfig(): Promise<boolean> {
			try {
				await resendClient.domains.list()
				return true
			} catch {
				return false
			}
		},
	}
}
