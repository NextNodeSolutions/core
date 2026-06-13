import { describe, expect, it } from 'vitest'

import { buildProjectLogsQuery, parseLogLines } from './log-query.ts'

describe('buildProjectLogsQuery', () => {
	it('filters by project, newest first, bounded', () => {
		const query = buildProjectLogsQuery('stylot')
		expect(query).toContain('nn_project:"stylot"')
		expect(query).toContain('sort by (_time desc)')
		expect(query).toContain('limit 200')
	})

	it('quotes a project name defensively', () => {
		expect(buildProjectLogsQuery('a b')).toContain('nn_project:"a b"')
	})
})

describe('parseLogLines', () => {
	it('parses newline-delimited JSON with time, message and container', () => {
		const body = [
			JSON.stringify({
				_time: '2026-06-13T10:00:00Z',
				_msg: 'hello',
				container_name: 'stylot-prod-web',
			}),
			JSON.stringify({ _time: '2026-06-13T10:00:01Z', _msg: 'world' }),
		].join('\n')

		expect(parseLogLines(body)).toEqual([
			{
				time: '2026-06-13T10:00:00Z',
				message: 'hello',
				container: 'stylot-prod-web',
			},
			{
				time: '2026-06-13T10:00:01Z',
				message: 'world',
				container: null,
			},
		])
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
