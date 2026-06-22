import { describe, expect, it } from 'vitest'

import {
	buildContainerLogsQuery,
	buildFleetErrorCountQuery,
	buildFleetLogsQuery,
	buildVpsLogsQuery,
	parseLogLevel,
	parseLogLines,
	parseStatsCount,
} from './log-query.ts'

describe('buildVpsLogsQuery', () => {
	it('filters by the VPS stream field (nn_project = hostname), newest first, bounded', () => {
		const query = buildVpsLogsQuery('nn-prod')
		expect(query).toContain('nn_project:"nn-prod"')
		expect(query).toContain('sort by (_time desc)')
		expect(query).toContain('limit 200')
	})

	it('unpacks the structured JSON trapped in _msg, after sort+limit', () => {
		const query = buildVpsLogsQuery('nn-prod')
		expect(query).toContain('| unpack_json')
		expect(query.indexOf('limit 200')).toBeLessThan(
			query.indexOf('| unpack_json'),
		)
	})
})

describe('buildContainerLogsQuery', () => {
	it('isolates a project by the container_name prefix, time-bounded', () => {
		const query = buildContainerLogsQuery('stylot')
		expect(query).toContain('container_name:~"^stylot-"')
		expect(query).toContain('_time:6h')
		expect(query).toContain('sort by (_time desc)')
		expect(query).toContain('limit 200')
	})

	it('unpacks the structured JSON trapped in _msg, after sort+limit', () => {
		const query = buildContainerLogsQuery('stylot')
		expect(query).toContain('| unpack_json')
		expect(query.indexOf('limit 200')).toBeLessThan(
			query.indexOf('| unpack_json'),
		)
	})

	it('escapes regex metacharacters in the project slug', () => {
		const query = buildContainerLogsQuery('a.b')
		// JSON.stringify encodes the regex `^a\.b-` as the LogsQL string
		// literal "^a\\.b-" (backslash doubled), which LogsQL unescapes
		// back to the literal-dot regex.
		expect(query).toContain(String.raw`container_name:~"^a\\.b-"`)
	})
})

describe('buildFleetLogsQuery', () => {
	it('streams the whole fleet newest-first within the time window', () => {
		const query = buildFleetLogsQuery()
		expect(query).toContain('_time:6h')
		expect(query).not.toContain('nn_project')
		expect(query).toContain('sort by (_time desc)')
		expect(query).toContain('limit 200')
	})

	it('honours an explicit window in hours', () => {
		expect(buildFleetLogsQuery(24)).toContain('_time:24h')
	})

	it('unpacks the structured JSON trapped in _msg, after sort+limit', () => {
		const query = buildFleetLogsQuery()
		expect(query).toContain('| unpack_json')
		expect(query.indexOf('limit 200')).toBeLessThan(
			query.indexOf('| unpack_json'),
		)
	})
})

describe('buildFleetErrorCountQuery', () => {
	it('counts errors over the WHOLE window with no limit (a true aggregate)', () => {
		const query = buildFleetErrorCountQuery(24)
		expect(query).toContain('_time:24h')
		expect(query).toContain('| stats count() if (')
		expect(query).toContain('as errors')
		// Crucially NOT a sort+limit display sample - that is the frozen-stat bug.
		expect(query).not.toContain('sort by')
		expect(query).not.toContain('limit')
	})

	it('unpacks _msg so the trapped level field is filterable', () => {
		const query = buildFleetErrorCountQuery(6)
		expect(query).toContain('| unpack_json')
		expect(query.indexOf('| unpack_json')).toBeLessThan(
			query.indexOf('| stats'),
		)
	})

	it('matches the error-ish level OR severity spellings, case-insensitively', () => {
		const query = buildFleetErrorCountQuery(6)
		expect(query).toContain(
			'level:~"(?i)^(error|err|fatal|critical|crit)$"',
		)
		expect(query).toContain(
			'severity:~"(?i)^(error|err|fatal|critical|crit)$"',
		)
	})

	it('defaults to the 6h window when none is given', () => {
		expect(buildFleetErrorCountQuery()).toContain('_time:6h')
	})
})

describe('parseStatsCount', () => {
	it('reads a named count returned as a string', () => {
		expect(parseStatsCount('{"errors":"42"}', 'errors')).toBe(42)
	})

	it('reads a named count returned as a number', () => {
		expect(parseStatsCount('{"errors":7}', 'errors')).toBe(7)
	})

	it('returns 0 for an empty body, missing field, or unparseable row', () => {
		expect(parseStatsCount('', 'errors')).toBe(0)
		expect(parseStatsCount('{"other":3}', 'errors')).toBe(0)
		expect(parseStatsCount('not json', 'errors')).toBe(0)
	})

	it('skips blank lines and reads the first valid stats row', () => {
		expect(parseStatsCount('\n\n{"errors":"5"}\n', 'errors')).toBe(5)
	})
})

describe('parseLogLevel', () => {
	it('normalises severity spellings to the four UI levels', () => {
		expect(parseLogLevel('WARNING')).toBe('warn')
		expect(parseLogLevel('err')).toBe('error')
		expect(parseLogLevel('fatal')).toBe('error')
		expect(parseLogLevel('trace')).toBe('debug')
		expect(parseLogLevel('Information')).toBe('info')
	})

	it('returns null for unknown or non-string levels (never guesses)', () => {
		expect(parseLogLevel('verbose')).toBeNull()
		expect(parseLogLevel(3)).toBeNull()
		expect(parseLogLevel(undefined)).toBeNull()
	})
})

describe('parseLogLines', () => {
	it('parses time, message, container, level and service from structured fields', () => {
		const body = [
			JSON.stringify({
				_time: '2026-06-13T10:00:00Z',
				_msg: 'hello',
				container_name: 'stylot-prod-web',
				severity: 'ERROR',
				nn_service: 'stylot-web',
			}),
			JSON.stringify({ _time: '2026-06-13T10:00:01Z', _msg: 'world' }),
		].join('\n')

		expect(parseLogLines(body)).toEqual([
			{
				time: '2026-06-13T10:00:00Z',
				message: 'hello',
				container: 'stylot-prod-web',
				level: 'error',
				service: 'stylot-web',
				vps: null,
				status: null,
				method: null,
				path: null,
				durationMs: null,
				traceId: null,
				stack: null,
				meta: {},
			},
			{
				time: '2026-06-13T10:00:01Z',
				message: 'world',
				container: null,
				level: null,
				service: null,
				vps: null,
				status: null,
				method: null,
				path: null,
				durationMs: null,
				traceId: null,
				stack: null,
				meta: {},
			},
		])
	})

	it('lifts request, trace and stack fields and keeps the rest as meta', () => {
		const body = JSON.stringify({
			_time: '2026-06-13T10:00:02Z',
			_msg: 'GET /api failed',
			nn_project: 'stylot-prod',
			level: 'error',
			status: 500,
			method: 'GET',
			path: '/api/users',
			duration_ms: 42,
			trace_id: 'abc123def456',
			stack: 'Error: boom\n  at handler',
			region: 'fsn1',
			retries: 2,
		})
		const [line] = parseLogLines(body)
		expect(line).toMatchObject({
			vps: 'stylot-prod',
			status: 500,
			method: 'GET',
			path: '/api/users',
			durationMs: 42,
			traceId: 'abc123def456',
			stack: 'Error: boom\n  at handler',
			meta: { region: 'fsn1', retries: '2' },
		})
	})

	it('skips blank lines and a truncated trailing fragment', () => {
		const body =
			'{"_time":"t","_msg":"ok"}\n\n{"_time":"t2","_msg":"ok2"}\n{"_time":'
		expect(parseLogLines(body)).toHaveLength(2)
	})

	it('drops objects missing _time or _msg', () => {
		expect(parseLogLines('{"_msg":"no time"}')).toEqual([])
	})

	// After `| unpack_json`, an app line carries BOTH the raw inner JSON in
	// `_msg` AND the @nextnode-solutions/logger fields (level, message,
	// requestId, location) lifted to the top level. The displayed message
	// must be the human `message`, never the raw JSON blob still in `_msg`.
	it('reads the unpacked application message, not the raw _msg JSON blob', () => {
		const inner = JSON.stringify({
			level: 'info',
			message: 'server started',
			requestId: 'abc',
		})
		const body = JSON.stringify({
			_time: '2026-06-15T12:00:00Z',
			_msg: inner,
			level: 'info',
			message: 'server started',
			requestId: 'abc',
			location: 'src/server.ts:12',
			timestamp: '2026-06-15T12:00:00Z',
			nn_service: 'app',
			nn_project: 'vps-1',
		})
		const [line] = parseLogLines(body)
		expect(line).toMatchObject({
			time: '2026-06-15T12:00:00Z',
			message: 'server started',
			level: 'info',
			service: 'app',
			vps: 'vps-1',
		})
		// `requestId`/`location` are useful context -> meta; the duplicated
		// `message`/`timestamp` and the raw `_msg` must NOT leak into meta.
		expect(line?.meta).toEqual({
			requestId: 'abc',
			location: 'src/server.ts:12',
		})
		expect(line?.message).not.toContain('{')
	})

	// A Caddy access line after `| unpack_json`: the JSON access record is
	// lifted top-level (status/method/uri/duration), `_msg` keeps the blob.
	it('extracts unpacked Caddy access fields (status, method, path, duration)', () => {
		const inner = JSON.stringify({
			level: 'info',
			msg: 'handled request',
			status: 200,
			method: 'GET',
			uri: '/health',
			duration: 12,
		})
		const body = JSON.stringify({
			_time: '2026-06-15T12:00:01Z',
			_msg: inner,
			level: 'info',
			msg: 'handled request',
			status: 200,
			method: 'GET',
			uri: '/health',
			duration: 12,
			logger: 'http.log.access.log0',
			nn_project: 'vps-1',
		})
		const [line] = parseLogLines(body)
		expect(line).toMatchObject({
			message: 'handled request',
			level: 'info',
			status: 200,
			method: 'GET',
			path: '/health',
			durationMs: 12,
			vps: 'vps-1',
		})
		expect(line?.meta).toMatchObject({ logger: 'http.log.access.log0' })
	})

	// A journald plain line is NOT JSON: `unpack_json` leaves it untouched,
	// so there is no `message` field. The display falls back to `_msg` and
	// the level stays null (never guessed from the text).
	it('falls back to _msg for plain (non-JSON) journald lines', () => {
		const body = JSON.stringify({
			_time: '2026-06-15T12:00:02Z',
			_msg: 'sshd: accepted login',
			nn_project: 'vps-1',
		})
		const [line] = parseLogLines(body)
		expect(line).toMatchObject({
			message: 'sshd: accepted login',
			level: null,
			vps: 'vps-1',
		})
	})
})
