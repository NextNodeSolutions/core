/**
 * Location parsing utilities for NextNode Logger
 * Extracts file, line, and function information from stack traces
 */

import type {
	DevelopmentLocationInfo,
	ProductionLocationInfo,
} from '../types.js'

// Constants for better performance and maintainability
/**
 * Maximum length for stack lines to prevent ReDoS attacks.
 * Lines longer than this will be truncated before regex matching.
 */
const MAX_STACK_LINE_LENGTH = 500

const STACK_TRACE_PATTERNS = {
	function: [
		/at\s+([^(\s]+)\s+\(/, // at functionName (file:line:col)
		/at\s+(.+?)\s+\(/, // at Object.functionName (file:line:col)
		/at\s+([^(\s]+)$/, // at functionName
		/at\s+(.+)$/, // fallback: everything after 'at '
	],
	file: [
		/\(([^)]+):(\d+):\d+\)/, // (file:line:col)
		/at\s+[^(]*\s+([^:\s]+(?:[:\\\\][^:\s]+)*):(\d+):\d+$/, // at function file:line:col
		/([^:\s]+(?:[:\\\\][^:\s]+)*):(\d+):\d+$/, // file:line:col at end
	],
} as const

// Internal files to skip when parsing stack traces
const INTERNAL_FILES = [
	'logger.ts',
	'nextnode-logger.ts',
	'factory.ts',
	'create-log-entry.ts',
	'location.ts',
	'console-node.ts',
	'console-browser.ts',
	'console.ts',
	'test-utils.ts',
] as const

const isValidStackLine = (line: string): boolean =>
	typeof line === 'string' &&
	line.includes('at ') &&
	!line.includes('node_modules')

const isInternalFile = (line: string): boolean =>
	INTERNAL_FILES.some(file => line.includes(file))

/**
 * Truncates a stack line if it exceeds the maximum length.
 * This prevents ReDoS attacks with maliciously long strings.
 */
const truncateStackLine = (line: string): string =>
	line.length > MAX_STACK_LINE_LENGTH
		? line.slice(0, MAX_STACK_LINE_LENGTH)
		: line

const extractFunctionName = (stackLine: string): string => {
	const safeLine = truncateStackLine(stackLine)

	for (const pattern of STACK_TRACE_PATTERNS.function) {
		const match = pattern.exec(safeLine)
		if (match?.[1]) {
			const functionName = match[1].trim()

			// Clean up common patterns
			if (functionName.includes('<anonymous>')) return 'anonymous'

			// Extract last part if it's a method call
			const lastDotIndex = functionName.lastIndexOf('.')
			if (lastDotIndex !== -1) {
				return functionName.slice(lastDotIndex + 1) || functionName
			}

			return functionName
		}
	}

	return 'unknown'
}

const extractFileInfo = (stackLine: string): { file: string; line: number } => {
	const safeLine = truncateStackLine(stackLine)

	for (const pattern of STACK_TRACE_PATTERNS.file) {
		const match = pattern.exec(safeLine)
		if (match?.[1] && match[2]) {
			const fullPath = match[1]
			const line = Number(match[2])

			// Extract filename from path efficiently
			const lastSeparatorIndex = Math.max(
				fullPath.lastIndexOf('/'),
				fullPath.lastIndexOf('\\'),
			)
			const file =
				lastSeparatorIndex !== -1
					? fullPath.slice(lastSeparatorIndex + 1)
					: fullPath

			return { file, line }
		}
	}

	return { file: 'unknown', line: 0 }
}

const getCallerStackLine = (stack: string): string => {
	const lines = stack.split('\n')

	// Find first non-internal stack line (skip Error line)
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i]
		if (line && isValidStackLine(line) && !isInternalFile(line)) {
			return line
		}
	}

	// Fallback to first line after Error if no valid line found
	return lines[1] ?? ''
}

export const parseLocation = (
	isProduction: boolean,
): DevelopmentLocationInfo | ProductionLocationInfo => {
	try {
		const stack = new Error().stack ?? ''
		const stackLine = getCallerStackLine(stack)

		const functionName = extractFunctionName(stackLine)

		if (isProduction) {
			return { function: functionName }
		}

		const { file, line } = extractFileInfo(stackLine)

		return {
			function: functionName,
			file,
			line,
		}
	} catch {
		// Fallback if stack trace parsing fails
		return isProduction
			? { function: 'unknown' }
			: { function: 'unknown', file: 'unknown', line: 0 }
	}
}
