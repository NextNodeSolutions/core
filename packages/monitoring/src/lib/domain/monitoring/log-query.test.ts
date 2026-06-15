import { describe, expect, it } from 'vitest'

import {
	buildContainerLogsQuery,
	buildFleetLogsQuery,
	buildVpsLogsQuery,
	parseLogLevel,
	parseLogLines,
} from './log-query.ts'

describe('buildVpsLogsQuery', () => {
	it('filters by the VPS stream field (nn_project = hostname), newest first, bounded', () => {
		const query = buildVpsLogsQuery('nn-prod')
		expect(query).toContain('nn_project:"nn-prod"')
		expect(query).toContain('sort by (_time desc)')
		expect(query).toContain('limit 200')
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
})
