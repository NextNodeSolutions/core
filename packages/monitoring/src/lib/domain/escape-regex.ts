/**
 * Escape every regex metacharacter so a value matches literally. Used wherever
 * a runtime slug is embedded in a regex context - an HTML5 `pattern` attribute
 * (the teardown confirmation gate) or a LogsQL `field:~` filter - so the value
 * cannot widen or break the match. Single source so the escaping never drifts.
 */
export const escapeRegex = (literal: string): string =>
	literal.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
