/**
 * Environment detection utilities for NextNode Logger
 * Provides clean detection between Node.js and browser environments,
 * plus build-time environment (development/production) resolution.
 */

import type { Environment, RuntimeEnvironment } from '../types.js'

/**
 * Detect the current runtime environment
 * Uses modern detection methods beyond simple typeof window checks
 */
export const detectRuntime = (): RuntimeEnvironment => {
	// Check for Node.js - most reliable method
	if (
		typeof process === 'object' &&
		typeof process.versions === 'object' &&
		typeof process.versions.node === 'string'
	) {
		return 'node'
	}

	// Check for Web Worker environment
	if (typeof importScripts === 'function') {
		return 'webworker'
	}

	// Check for Browser environment
	if (typeof window === 'object' && typeof document === 'object') {
		return 'browser'
	}

	return 'unknown'
}

/**
 * Check if Web Crypto API is available in current environment
 */
export const hasCryptoSupport = (): boolean => {
	try {
		return !!(crypto && typeof crypto.randomUUID === 'function')
	} catch {
		return false
	}
}

/**
 * Resolves the build-time environment from NODE_ENV.
 * Defaults to 'development' when unset for safer (more verbose) logging.
 */
export const detectEnvironment = (): Environment => {
	const nodeEnv =
		typeof process !== 'undefined' ? process.env.NODE_ENV : undefined

	if (nodeEnv === 'production' || nodeEnv === 'prod') {
		return 'production'
	}

	if (nodeEnv === 'development' || nodeEnv === 'dev') {
		return 'development'
	}

	return 'development'
}
