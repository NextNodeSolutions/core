/**
 * Time utilities for NextNode Logger
 * Zero dependencies, using only Node.js built-in modules
 */

export const getCurrentTimestamp = (): string => new Date().toISOString()

/**
 * Formats an ISO timestamp to HH:MM:SS format for console output.
 * Returns the original string when the input is not a valid date.
 */
export const formatTimeForDisplay = (timestamp: string): string => {
	const date = new Date(timestamp)
	if (Number.isNaN(date.getTime())) {
		return timestamp
	}
	const hours = date.getUTCHours().toString().padStart(2, '0')
	const minutes = date.getUTCMinutes().toString().padStart(2, '0')
	const seconds = date.getUTCSeconds().toString().padStart(2, '0')
	return `${hours}:${minutes}:${seconds}`
}
