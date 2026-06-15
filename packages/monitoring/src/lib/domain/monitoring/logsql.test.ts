import { describe, expect, it } from 'vitest'

import { logsqlQuoted } from './logsql.ts'

describe('logsqlQuoted', () => {
	it('quotes and escapes so a value cannot break out of the token', () => {
		expect(logsqlQuoted('nn-prod')).toBe('"nn-prod"')
		expect(logsqlQuoted('a"b')).toBe(String.raw`"a\"b"`)
		expect(logsqlQuoted('a\\b')).toBe(String.raw`"a\\b"`)
	})
})
