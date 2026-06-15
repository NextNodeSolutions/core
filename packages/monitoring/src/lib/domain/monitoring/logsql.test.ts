import { describe, expect, it } from 'vitest'

import { escapeLogsqlRegex, logsqlQuoted } from './logsql.ts'

describe('logsqlQuoted', () => {
	it('quotes and escapes so a value cannot break out of the token', () => {
		expect(logsqlQuoted('nn-prod')).toBe('"nn-prod"')
		expect(logsqlQuoted('a"b')).toBe(String.raw`"a\"b"`)
		expect(logsqlQuoted('a\\b')).toBe(String.raw`"a\\b"`)
	})
})

describe('escapeLogsqlRegex', () => {
	it('leaves a plain kebab slug untouched', () => {
		expect(escapeLogsqlRegex('my-project')).toBe('my-project')
	})

	it('escapes regex metacharacters', () => {
		expect(escapeLogsqlRegex('a.b*c')).toBe(String.raw`a\.b\*c`)
	})
})
