/**
 * Resend email provider
 * Implementation of EmailProvider interface for Resend
 */

import { fail } from '../types/result.js'

import { createProviderUtils } from './base.js'

import type { Logger } from '@nextnode-solutions/logger'
import type {
	Attachment,
	CreateEmailOptions,
	ErrorResponse,
	Resend,
} from 'resend'
import type { EmailMessage } from '../types/email.js'
import type { EmailProvider } from '../types/provider.js'
import type { EmailError, SendResult } from '../types/result.js'
import type { ProviderUtils } from './base.js'

const HTTP_VALIDATION_ERROR = 422
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_RATE_LIMIT = 429

const MISSING_RETURNED_MESSAGE = 'Resend returned an error without a message'

interface ResendErrorRule {
	names: ReadonlyArray<ErrorResponse['name']>
	statuses: readonly number[]
	needles: readonly string[]
	code: EmailError['code']
	message: string | null
}

/**
 * Classification rules for Resend errors (FR-20).
 * A returned error matches on `names`, then on `statuses`, then on `needles`
 * in its message. A thrown error matches on `needles` only. Within a stage
 * the first matching rule wins. `message: null` keeps the original message.
 */
const RESEND_ERROR_RULES: readonly ResendErrorRule[] = [
	{
		names: [
			'rate_limit_exceeded',
			'daily_quota_exceeded',
			'monthly_quota_exceeded',
		],
		statuses: [HTTP_RATE_LIMIT],
		needles: ['rate limit', String(HTTP_RATE_LIMIT)],
		code: 'RATE_LIMIT_ERROR',
		message: 'Rate limit exceeded',
	},
	{
		names: ['missing_api_key', 'invalid_api_key', 'restricted_api_key'],
		statuses: [HTTP_UNAUTHORIZED, HTTP_FORBIDDEN],
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
		names: [
			'validation_error',
			'missing_required_field',
			'invalid_parameter',
			'invalid_attachment',
			'invalid_from_address',
		],
		statuses: [HTTP_VALIDATION_ERROR],
		needles: ['validation', String(HTTP_VALIDATION_ERROR)],
		code: 'VALIDATION_ERROR',
		message: null,
	},
	{
		names: [],
		statuses: [],
		needles: ['network', 'econnrefused', 'timeout', 'fetch'],
		code: 'NETWORK_ERROR',
		message: null,
	},
]

const ruleForMessage = (message: string): ResendErrorRule | undefined => {
	const lowered = message.toLowerCase()
	return RESEND_ERROR_RULES.find(rule =>
		rule.needles.some(needle => lowered.includes(needle)),
	)
}

const ruleForReturnedError = (
	error: ErrorResponse,
	message: string,
): ResendErrorRule | undefined =>
	RESEND_ERROR_RULES.find(rule => rule.names.includes(error.name)) ??
	RESEND_ERROR_RULES.find(
		rule =>
			error.statusCode !== null &&
			rule.statuses.includes(error.statusCode),
	) ??
	ruleForMessage(message)

// The SDK returns the API's error body unchecked, so its message may be absent.
const returnedMessageOf = (message: unknown): string =>
	typeof message === 'string' ? message : MISSING_RETURNED_MESSAGE

const classifiedError = (
	rule: ResendErrorRule | undefined,
	message: string,
	originalError: unknown,
): EmailError => ({
	code: rule?.code ?? 'PROVIDER_ERROR',
	message: rule?.message ?? message,
	provider: 'resend',
	originalError,
})

const mapReturnedError = (error: ErrorResponse): EmailError => {
	const message = returnedMessageOf(error.message)
	return classifiedError(ruleForReturnedError(error, message), message, error)
}

const mapThrownError = (error: unknown): EmailError => {
	if (error instanceof Error) {
		return classifiedError(
			ruleForMessage(error.message),
			error.message,
			error,
		)
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
			return fail(mapReturnedError(error))
		}

		return {
			success: true,
			data: { id: data.id, provider: 'resend', sentAt: new Date() },
		}
	} catch (error) {
		logger.error('Resend send failed', {
			details: { error: errorMessageOf(error) },
		})
		return fail(mapThrownError(error))
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
				const { error } = await resendClient.domains.list()
				if (error) {
					logger.error('Resend validateConfig failed', {
						details: { error: error.message },
					})
				}
				return !error
			} catch (error) {
				logger.error('Resend validateConfig failed', {
					details: { error: errorMessageOf(error) },
				})
				return false
			}
		},
	}
}
