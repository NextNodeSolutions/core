/**
 * Provider registry
 * Factory pattern for creating email providers (FR-16)
 */

import { createLogger } from '@nextnode-solutions/logger'
import type { Logger } from '@nextnode-solutions/logger'

import type {
	EmailProvider,
	ProviderConfigMap,
	ResendProviderConfig,
} from '../types/provider.js'

import { createResendProvider } from './resend.js'

/**
 * Initialize the Resend provider
 *
 * @throws Error if API key is invalid format (EC-2: fail-fast at setup)
 * @throws Error if the resend package is not installed
 */
async function initResend(
	config: ResendProviderConfig,
	logger: Logger,
): Promise<EmailProvider> {
	if (!config.apiKey || config.apiKey.trim().length === 0) {
		throw new Error('Resend API key is required and cannot be empty')
	}

	const resendModule = await import('resend').catch(() => {
		throw new Error(
			'The "resend" package is required to use the Resend provider. Install it with: pnpm add resend',
		)
	})

	const client = new resendModule.Resend(config.apiKey)
	return createResendProvider(client, logger)
}

/**
 * Create an email provider by name (FR-16)
 *
 * Provider SDKs are dynamically imported so the library doesn't crash
 * when an unused provider's package is not installed.
 *
 * @param name - Provider name
 * @param config - Provider-specific configuration
 * @param logger - Optional logger; defaults to silent
 * @returns EmailProvider instance
 *
 * @throws Error if API key is invalid format (EC-2: fail-fast at setup)
 * @throws Error if provider SDK is not installed
 */
export async function createProvider<K extends keyof ProviderConfigMap>(
	name: K,
	config: ProviderConfigMap[K],
	logger?: Logger,
): Promise<EmailProvider>
export async function createProvider(
	name: keyof ProviderConfigMap,
	config: ProviderConfigMap[keyof ProviderConfigMap],
	logger?: Logger,
): Promise<EmailProvider> {
	// Business rule: silent by default — caller opts into logging by injecting a logger
	const resolvedLogger = logger ?? createLogger({ silent: true })

	switch (name) {
		case 'resend':
			return initResend(config, resolvedLogger)
		default:
			throw new Error(`Unknown provider: ${String(name)}`)
	}
}
