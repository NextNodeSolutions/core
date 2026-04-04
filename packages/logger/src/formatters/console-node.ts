/**
 * Node.js console formatter for NextNode Logger
 * Uses ANSI escape codes for colorized terminal output
 */

import type { LogEntry, LogLevel } from '../types.js'
import { safeStringify } from '../utils/serialization.js'
import { formatTimeForDisplay } from '../utils/time.js'

import { LOG_LEVEL_ICONS, formatLocationForDisplay } from './shared.js'

const COLORS = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
	white: '\x1b[37m',
	gray: '\x1b[90m',
} as const

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
	debug: COLORS.gray,
	info: COLORS.blue,
	warn: COLORS.yellow,
	error: COLORS.red,
} as const

const SCOPE_COLORS = [
	COLORS.green,
	COLORS.magenta,
	COLORS.cyan,
	COLORS.yellow,
	COLORS.blue,
] as const

// LRU-like cache with max size to prevent memory leaks
const MAX_SCOPE_CACHE_SIZE = 100
let scopeColorIndex = 0
const scopeColorMap = new Map<string, string>()

const getScopeColor = (scope: string): string => {
	let color = scopeColorMap.get(scope)

	if (!color) {
		// Implement cache eviction when size limit reached
		if (scopeColorMap.size >= MAX_SCOPE_CACHE_SIZE) {
			const firstKey = scopeColorMap.keys().next().value
			if (firstKey) scopeColorMap.delete(firstKey)
		}

		color =
			SCOPE_COLORS[scopeColorIndex % SCOPE_COLORS.length] ?? COLORS.white
		scopeColorMap.set(scope, color)
		scopeColorIndex = (scopeColorIndex + 1) % SCOPE_COLORS.length
	}

	return color
}

const colorize = (text: string, color: string): string =>
	`${color}${text}${COLORS.reset}`

const formatPropertyLines = (
	key: string,
	valueStr: string,
	prefix: string,
): string[] => {
	if (!valueStr.includes('\n')) {
		return [colorize(`   ${prefix} ${key}: ${valueStr}`, COLORS.gray)]
	}

	const lines = [colorize(`   ${prefix} ${key}:`, COLORS.gray)]
	for (const line of valueStr.split('\n')) {
		lines.push(colorize(`      ${line}`, COLORS.gray))
	}
	return lines
}

const formatObjectDetails = (object: LogEntry['object']): string[] => {
	const lines: string[] = []

	if (!object) return lines

	// Format all properties of the object
	const entries = Object.entries(object)
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		if (!entry) continue

		const [key, value] = entry
		if (value === undefined) continue

		const isLast = i === entries.length - 1
		const prefix = isLast ? '└─' : '├─'
		const valueStr =
			typeof value === 'object' ? safeStringify(value) : String(value)

		lines.push(...formatPropertyLines(key, valueStr, prefix))
	}

	return lines
}

export const formatForNode = (entry: LogEntry): string => {
	const { level, message, timestamp, location, requestId, scope, object } =
		entry

	const components: string[] = []

	// Icon and level
	components.push(LOG_LEVEL_ICONS[level])
	components.push(
		colorize(level.toUpperCase().padEnd(5), LOG_LEVEL_COLORS[level]),
	)

	// Scope if present
	if (scope) {
		components.push(colorize(`[${scope}]`, getScopeColor(scope)))
	}

	// Timestamp
	components.push(
		colorize(`[${formatTimeForDisplay(timestamp)}]`, COLORS.gray),
	)

	// Message
	components.push(message)

	// Location and request ID (dimmed)
	components.push(
		colorize(
			`(${formatLocationForDisplay(location)}) [${requestId}]`,
			COLORS.dim,
		),
	)

	const lines = [components.join(' ')]

	// Add object details if present
	lines.push(...formatObjectDetails(object))

	return lines.join('\n')
}

export const resetScopeCache = (): void => {
	scopeColorMap.clear()
	scopeColorIndex = 0
}
