/**
 * Email type definitions
 * Core types for email messages, recipients, and attachments
 */

import type React from 'react'

/**
 * Email recipient — string or object with name
 */
export type EmailRecipient = string | { email: string; name?: string }

/**
 * Email attachment
 */
export interface EmailAttachment {
	/** Filename with extension */
	filename: string
	/** Content as Buffer, base64 string, or URL */
	content: Buffer | string
	/** Optional content type (e.g., 'application/pdf') */
	contentType?: string | undefined
}

/**
 * Email header
 */
export interface EmailHeader {
	name: string
	value: string
}

/**
 * Email tag for tracking/analytics
 */
export interface EmailTag {
	name: string
	value: string
}

/**
 * Template render options
 */
export interface TemplateRenderOptions {
	/** Pretty-print HTML (dev mode) */
	pretty?: boolean | undefined
	/** Also generate plain text version (default: true) */
	plainText?: boolean | undefined
}

/**
 * React Email template component type
 */
export type EmailTemplateComponent<TProps = Record<string, unknown>> = (
	props: TProps,
) => React.ReactElement

/**
 * Rendered template output
 */
export interface RenderedTemplate {
	html: string
	text?: string | undefined
}

/**
 * Core email message interface (post-render, with html/text)
 */
export interface EmailMessage {
	/** Sender email address or object with name */
	from: EmailRecipient
	/** Primary recipient(s) — max 50 */
	to: EmailRecipient | EmailRecipient[]
	/** Email subject */
	subject: string
	/** CC recipients */
	cc?: EmailRecipient | EmailRecipient[] | undefined
	/** BCC recipients */
	bcc?: EmailRecipient | EmailRecipient[] | undefined
	/** Reply-to address(es) */
	replyTo?: EmailRecipient | EmailRecipient[] | undefined
	/** HTML content */
	html: string
	/** Plain text content */
	text?: string | undefined
	/** File attachments */
	attachments?: EmailAttachment[] | undefined
	/** Custom headers */
	headers?: EmailHeader[] | undefined
	/** Tags for tracking */
	tags?: EmailTag[] | undefined
	/** Schedule send time (ISO 8601 or Date) */
	scheduledAt?: string | Date | undefined
}

/**
 * Email message with React Email template support (pre-render)
 */
export interface TemplatedEmailMessage<TProps = Record<string, unknown>> {
	/** Primary recipient(s) */
	to: EmailRecipient | EmailRecipient[]
	/** Email subject */
	subject: string
	/** React Email component */
	template: EmailTemplateComponent<TProps>
	/** Props for the template */
	props: TProps
	/** Sender (overrides defaultFrom) */
	from?: EmailRecipient | undefined
	/** CC recipients */
	cc?: EmailRecipient | EmailRecipient[] | undefined
	/** BCC recipients */
	bcc?: EmailRecipient | EmailRecipient[] | undefined
	/** Reply-to address(es) */
	replyTo?: EmailRecipient | EmailRecipient[] | undefined
	/** File attachments */
	attachments?: EmailAttachment[] | undefined
	/** Custom headers */
	headers?: EmailHeader[] | undefined
	/** Tags for tracking */
	tags?: EmailTag[] | undefined
	/** Schedule send time (ISO 8601 or Date) */
	scheduledAt?: string | Date | undefined
}
