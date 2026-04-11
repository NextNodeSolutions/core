export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * Minimum contract the ingest endpoint enforces on each log entry.
 *
 * The wire format is dictated by `@nextnode-solutions/logger`'s HTTP transport,
 * but we validate only the fields the monitoring service actually relies on
 * (level routing, timestamp, message body). Unknown extra fields are allowed
 * through the index signature so the logger can evolve without breaking ingest.
 */
export interface IngestedLogEntry {
	readonly level: LogLevel
	readonly message: string
	readonly timestamp: string
	readonly [key: string]: unknown
}

export interface LogEnvelope {
	readonly logs: ReadonlyArray<IngestedLogEntry>
}

export type ValidationResult =
	| { readonly ok: true; readonly envelope: LogEnvelope }
	| { readonly ok: false; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLogLevel(value: unknown): value is LogLevel {
	if (typeof value !== 'string') return false
	return LOG_LEVELS.some(level => level === value)
}

type EntryResult =
	| { readonly ok: true; readonly entry: IngestedLogEntry }
	| { readonly ok: false; readonly error: string }

function validateEntry(value: unknown, index: number): EntryResult {
	if (!isRecord(value)) {
		return { ok: false, error: `logs[${index}] must be an object` }
	}
	const level = value['level']
	if (!isLogLevel(level)) {
		return {
			ok: false,
			error: `logs[${index}].level must be one of: ${LOG_LEVELS.join(', ')}`,
		}
	}
	const message = value['message']
	if (typeof message !== 'string') {
		return { ok: false, error: `logs[${index}].message must be a string` }
	}
	const timestamp = value['timestamp']
	if (typeof timestamp !== 'string') {
		return {
			ok: false,
			error: `logs[${index}].timestamp must be a string`,
		}
	}
	return {
		ok: true,
		entry: { ...value, level, message, timestamp },
	}
}

export function validateLogEnvelope(body: unknown): ValidationResult {
	if (!isRecord(body)) {
		return { ok: false, error: 'body must be a JSON object' }
	}
	const logs = body['logs']
	if (!Array.isArray(logs)) {
		return { ok: false, error: 'body.logs must be an array' }
	}
	const validated: IngestedLogEntry[] = []
	for (let i = 0; i < logs.length; i++) {
		const result = validateEntry(logs[i], i)
		if (!result.ok) {
			return { ok: false, error: result.error }
		}
		validated.push(result.entry)
	}
	return { ok: true, envelope: { logs: validated } }
}
