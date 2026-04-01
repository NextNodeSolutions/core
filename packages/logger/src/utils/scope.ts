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
	cleanObject: Omit<LogObject, "scope"> | undefined;
} => {
	if (!object) {
		return { scope: undefined, cleanObject: undefined };
	}

	const { scope, ...rest } = object;
	const hasOtherProperties = Object.keys(rest).length > 0;

	return {
		scope: scope ?? undefined,
		cleanObject: hasOtherProperties ? rest : undefined,
	};
};
