/**
 * Browser console formatter for NextNode Logger
 * Uses CSS styling and console API features for DevTools
 */

import type { LogEntry, LogLevel } from '../types.js'
import { formatTimeForDisplay } from '../utils/time.js'

import { LOG_LEVEL_ICONS, formatLocationForDisplay } from './shared.js'

// CSS styles for browser DevTools
const STYLES = {
	reset: '',
	bold: 'font-weight: bold',
	dim: 'color: #888',
	debug: 'color: #888; font-weight: bold',
	info: 'color: #2196F3; font-weight: bold',
	warn: 'color: #FF9800; font-weight: bold',
	error: 'color: #F44336; font-weight: bold',
	scope: {
		green: 'color: #4CAF50; font-weight: bold',
		magenta: 'color: #E91E63; font-weight: bold',
		cyan: 'color: #00BCD4; font-weight: bold',
		yellow: 'color: #FFEB3B; font-weight: bold',
		blue: 'color: #2196F3; font-weight: bold',
	},
	timestamp: 'color: #888',
	location: 'color: #888; font-style: italic',
	message: 'color: inherit',
} as const

const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
	debug: STYLES.debug,
	info: STYLES.info,
	warn: STYLES.warn,
	error: STYLES.error,
} as const

const SCOPE_STYLE_KEYS = ['green', 'magenta', 'cyan', 'yellow', 'blue'] as const

// LRU-like cache with max size
const MAX_SCOPE_CACHE_SIZE = 100
let scopeStyleIndex = 0
const scopeStyleMap = new Map<string, string>()

const getScopeStyle = (scope: string): string => {
	let style = scopeStyleMap.get(scope)

	if (!style) {
		if (scopeStyleMap.size >= MAX_SCOPE_CACHE_SIZE) {
			const firstKey = scopeStyleMap.keys().next().value
			if (firstKey) scopeStyleMap.delete(firstKey)
		}

		const styleKey =
			SCOPE_STYLE_KEYS[scopeStyleIndex % SCOPE_STYLE_KEYS.length] ??
			'green'
		style = STYLES.scope[styleKey]
		scopeStyleMap.set(scope, style)
		scopeStyleIndex = (scopeStyleIndex + 1) % SCOPE_STYLE_KEYS.length
	}

	return style
}

export interface BrowserLogOutput {
	format: string
	styles: string[]
	objects: unknown[]
}

/**
 * Formats a log entry for browser DevTools.
 * Returns an object with:
 * - format: The format string with %c placeholders for styling
 * - styles: Array of CSS styles to apply
 * - objects: Additional objects to pass directly to console (for expandable inspection)
 */
export const formatForBrowser = (entry: LogEntry): BrowserLogOutput => {
	const { level, message, timestamp, location, requestId, scope, object } =
		entry

	const formatParts: string[] = []
	const styles: string[] = []

	// Icon (no style needed)
	formatParts.push(LOG_LEVEL_ICONS[level])

	// Level with style
	formatParts.push(`%c${level.toUpperCase().padEnd(5)}`)
	styles.push(LOG_LEVEL_STYLES[level])

	// Scope if present
	if (scope) {
		formatParts.push(`%c[${scope}]`)
		styles.push(getScopeStyle(scope))
	}

	// Timestamp
	formatParts.push(`%c[${formatTimeForDisplay(timestamp)}]`)
	styles.push(STYLES.timestamp)

	// Message (reset to default)
	formatParts.push(`%c${message}`)
	styles.push(STYLES.message)

	// Location and request ID
	formatParts.push(`%c(${formatLocationForDisplay(location)}) [${requestId}]`)
	styles.push(STYLES.location)

	const objects: unknown[] = []

	// Pass object directly for expandable inspection in DevTools
	if (object && Object.keys(object).length > 0) {
		objects.push(object)
	}

	return {
		format: formatParts.join(' '),
		styles,
		objects,
	}
}

/**
 * Creates the arguments array to spread into console.log/warn/error
 * Usage: console[level](...createBrowserLogArgs(entry))
 */
export const createBrowserLogArgs = (entry: LogEntry): unknown[] => {
	const { format, styles, objects } = formatForBrowser(entry)
	return [format, ...styles, ...objects]
}

export const resetScopeCache = (): void => {
	scopeStyleMap.clear()
	scopeStyleIndex = 0
}
