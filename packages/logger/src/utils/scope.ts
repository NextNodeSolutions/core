/**
 * Scope extraction utility for NextNode Logger
 * Separates scope from other log object properties
 */

import type { LogObject } from "../types.js";

/**
 * Extracts scope from a log object and returns it separately from other properties.
 * Used by logger to handle scope-based organization.
 */
export const extractScope = (
	object?: LogObject,
): {
	scope: string | undefined;
	requestId: string | undefined;
	cleanObject: Omit<LogObject, "scope" | "requestId"> | undefined;
} => {
	if (!object) {
		return {
			scope: undefined,
			requestId: undefined,
			cleanObject: undefined,
		};
	}

	const { scope, requestId, ...rest } = object;
	const hasOtherProperties = Object.keys(rest).length > 0;

	return {
		scope,
		requestId,
		cleanObject: hasOtherProperties ? rest : undefined,
	};
};
