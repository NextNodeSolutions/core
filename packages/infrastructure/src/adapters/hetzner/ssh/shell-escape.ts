/**
 * POSIX shell single-quote escaping.
 *
 * Wraps the input in single quotes, and safely escapes any embedded
 * single quote by closing the quoted region, inserting an escaped
 * quote, and reopening: `'` → `'\''`.
 *
 * The result is always safe to interpolate into a shell command line
 * executed via `sh -c`, which is what ssh2 `Client.exec` uses.
 */
export function shellEscape(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`
}
