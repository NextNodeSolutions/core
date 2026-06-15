/**
 * LogsQL quoting helpers - the single source of how a runtime value is safely
 * embedded into a VictoriaLogs query, so the escaping can never drift between
 * the query builders.
 */

/**
 * Quote a value as a LogsQL string literal. JSON.stringify yields a
 * double-quoted, backslash/quote-escaped string - exactly what a LogsQL field
 * filter needs - so a slug carrying `"` or `\` cannot break out of the token.
 */
export const logsqlQuoted = (token: string): string => JSON.stringify(token)

/**
 * Escape a slug for safe embedding inside a LogsQL regex filter (`field:~...`).
 * Project names are kebab identifiers today, but a deploy could in principle
 * carry a regex metachar - escape defensively.
 */
export const escapeLogsqlRegex = (slug: string): string =>
	slug.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
