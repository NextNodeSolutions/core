/**
 * Logger factory
 * Provides `createLogger` for building logger instances.
 */

import type { LoggerConfig } from '../types.js'

import { NextNodeLogger } from './nextnode-logger.js'

/**
 * Factory function for creating logger instances.
 *
 * @example
 * // Basic usage
 * const logger = createLogger()
 * logger.info('Hello world')
 *
 * @example
 * // With configuration
 * const logger = createLogger({
 *   minLevel: 'warn',  // Only log warn and error
 *   prefix: '[MyApp]',
 *   environment: 'production'
 * })
 *
 * @example
 * // Silent mode for tests
 * const logger = createLogger({ silent: true })
 *
 * @example
 * // With custom transports
 * import { HttpTransport } from '@nextnode/logger/transports/http'
 * const logger = createLogger({
 *   transports: [
 *     new ConsoleTransport(),
 *     new HttpTransport({ endpoint: 'https://logs.example.com' })
 *   ]
 * })
 */
export const createLogger = (config?: LoggerConfig): NextNodeLogger =>
	new NextNodeLogger(config)
