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

/**
 * The function a caller invoked to log. The stack is cut at its frame, so the
 * first frame left is the code that called it, however the logger's own files
 * were bundled or renamed.
 */
export type StackEntryPoint = (...args: never[]) => unknown

const isValidStackLine = (line: string): boolean =>
	typeof line === 'string' &&
	line.includes('at ') &&
	!line.includes('node_modules')

/**
 * Truncates a stack line if it exceeds the maximum length.
 * This prevents ReDoS attacks with maliciously long strings.
 */
const truncateStackLine = (line: string): string =>
	line.length > MAX_STACK_LINE_LENGTH
		? line.slice(0, MAX_STACK_LINE_LENGTH)
		: line

const cleanFunctionName = (rawName: string): string => {
	const functionName = rawName.trim()

	// Clean up common patterns
	if (functionName.includes('<anonymous>')) return 'anonymous'

	// Extract last part if it's a method call
	const lastDotIndex = functionName.lastIndexOf('.')
	if (lastDotIndex === -1) return functionName

	return functionName.slice(lastDotIndex + 1) || functionName
}

// A V8 frame without parentheses holds only a location, as top-level module
// code and anonymous callbacks do, so it names no function.
const LOCATION_ONLY_FRAME = /at\s+(?:async\s+)?[^()]+:\d+:\d+$/

const extractFunctionName = (stackLine: string): string => {
	const safeLine = truncateStackLine(stackLine)
	if (LOCATION_ONLY_FRAME.test(safeLine)) return 'anonymous'

	for (const pattern of STACK_TRACE_PATTERNS.function) {
		const match = pattern.exec(safeLine)
		if (match?.[1]) return cleanFunctionName(match[1])
	}

	return 'unknown'
}

const extractFileInfo = (stackLine: string): { file: string; line: number } => {
	const safeLine = truncateStackLine(stackLine)

	for (const pattern of STACK_TRACE_PATTERNS.file) {
		const match = pattern.exec(safeLine)
		if (match?.[1] && match[2]) {
			const [, fullPath] = match
			const line = Number(match[2])

			// Extract filename from path efficiently
			const lastSeparatorIndex = Math.max(
				fullPath.lastIndexOf('/'),
				fullPath.lastIndexOf('\\'),
			)
			const file =
				lastSeparatorIndex === -1
					? fullPath
					: fullPath.slice(lastSeparatorIndex + 1)

			return { file, line }
		}
	}

	return { file: 'unknown', line: 0 }
}

// Drops the first line, which holds the error name and message, not a frame
const toFrames = (stack: string | undefined): string[] =>
	(stack ?? '').split('\n').slice(1)

/**
 * Returns the frames below the entry point, so the first one is its caller.
 * Without Error.captureStackTrace the entry point cannot be found, and no
 * frame is returned rather than one inside the logger.
 */
const captureFramesBelow = (entryPoint: StackEntryPoint): string[] => {
	if (typeof Error.captureStackTrace !== 'function') return []

	const holder: { stack?: string } = {}
	Error.captureStackTrace(holder, entryPoint)
	return toFrames(holder.stack)
}

const getCallerStackLine = (frames: readonly string[]): string =>
	frames.find(isValidStackLine) ?? frames[0] ?? ''

/**
 * Locates the code that called the entry point. Without one, it locates the
 * code that called parseLocation itself: that caller is the frame right after
 * this function's own, so no cut is needed.
 */
export const parseLocation = (
	isProduction: boolean,
	entryPoint?: StackEntryPoint,
): DevelopmentLocationInfo | ProductionLocationInfo => {
	try {
		const frames = entryPoint
			? captureFramesBelow(entryPoint)
			: toFrames(new Error().stack).slice(1)
		const stackLine = getCallerStackLine(frames)

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
	} catch (error) {
		// Business rule: logging must never be blocked by broken stack
		// parsing. Report 'unknown' location so the actual log entry still
		// goes through, but surface the parse failure via `console.warn`
		// (the logger cannot log itself without recursing here).
		console.warn(
			`[logger] stack trace parsing failed: ${error instanceof Error ? error.message : String(error)}`,
		)
		return isProduction
			? { function: 'unknown' }
			: { function: 'unknown', file: 'unknown', line: 0 }
	}
}
