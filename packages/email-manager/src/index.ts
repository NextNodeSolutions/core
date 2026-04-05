/**
 * @nextnode-solutions/email-manager
 * Template-first email sending library for NextNode projects
 */

// Main API (FR-5)
export { createEmailManager } from './email-manager.js'
export type { EmailManager, EmailManagerConfig } from './email-manager.js'

// Provider exports (FR-15, FR-16)
export { createProvider } from './providers/registry.js'

// Template exports (FR-11)
export { renderTemplate } from './templates/renderer.js'

// Type exports
export type {
	EmailAttachment,
	EmailHeader,
	EmailMessage,
	EmailRecipient,
	EmailTag,
	EmailTemplateComponent,
	RenderedTemplate,
	TemplatedEmailMessage,
	TemplateRenderOptions,
} from './types/email.js'
export type {
	EmailProvider,
	ProviderConfigMap,
	ResendProviderConfig,
} from './types/provider.js'
export type {
	EmailError,
	EmailErrorCode,
	Result,
	SendResult,
	SendSuccess,
} from './types/result.js'

// Logger type re-export (for consumers injecting their own logger)
export type { Logger } from '@nextnode-solutions/logger'
