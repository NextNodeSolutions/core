/**
 * Shared formatter utilities for NextNode Logger
 * Common formatting functions used by console formatters
 */

import type { LogEntry } from "../types.js";
import { isDevelopmentLocation } from "../types.js";

/**
 * Formats location info for console output.
 * Development: "file:line:function"
 * Production: "function"
 */
export const formatLocationForDisplay = (location: LogEntry["location"]): string => {
	if (isDevelopmentLocation(location)) {
		return `${location.file}:${location.line}:${location.function}`;
	}
	return location.function;
};
