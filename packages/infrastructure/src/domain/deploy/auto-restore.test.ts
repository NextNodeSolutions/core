import { describe, expect, it } from 'vitest'

import {
	assertDbPopulatedAfterRestore,
	databaseHasData,
	parsePsqlTableCount,
	planAutoRestore,
} from './auto-restore.ts'

import type { AutoRestoreResult } from './auto-restore.ts'

describe('planAutoRestore', () => {
	it('restores when the database is empty and a prior dump exists', () => {
		expect(planAutoRestore({ tableCountBefore: 0, snapshotCount: 3 })).toBe(
			'restore',
		)
	})

	it('never overwrites a populated database, even when dumps exist', () => {
		expect(planAutoRestore({ tableCountBefore: 5, snapshotCount: 9 })).toBe(
			'skip-db-populated',
		)
	})

	it('starts empty on a genuine first deploy (empty DB, no dump)', () => {
		expect(planAutoRestore({ tableCountBefore: 0, snapshotCount: 0 })).toBe(
			'skip-no-backup',
		)
	})

	it('treats a single user table as populated (the migrations table counts)', () => {
		expect(planAutoRestore({ tableCountBefore: 1, snapshotCount: 4 })).toBe(
			'skip-db-populated',
		)
	})
})

describe('parsePsqlTableCount', () => {
	it('parses the bare integer psql -tA prints', () => {
		expect(parsePsqlTableCount('0\n')).toBe(0)
		expect(parsePsqlTableCount('42\n')).toBe(42)
	})

	it('tolerates surrounding whitespace', () => {
		expect(parsePsqlTableCount('  7  \n')).toBe(7)
	})

	it('rejects a non-integer rather than guessing zero', () => {
		expect(() => parsePsqlTableCount('')).toThrow(/integer table count/)
		expect(() => parsePsqlTableCount('not a number')).toThrow(
			/integer table count/,
		)
	})

	it('rejects a trailing-garbage result (e.g. a leaked NOTICE)', () => {
		expect(() => parsePsqlTableCount('5 rows')).toThrow(
			/integer table count/,
		)
		expect(() => parsePsqlTableCount('5\n6')).toThrow(/integer table count/)
	})
})

describe('assertDbPopulatedAfterRestore', () => {
	it('passes when the restore created tables', () => {
		expect(() => assertDbPopulatedAfterRestore(3)).not.toThrow()
	})

	it('fails loud when the database is still empty after a restore', () => {
		expect(() => assertDbPopulatedAfterRestore(0)).toThrow(
			/still empty after restoring/,
		)
	})
})

const outcomeWith = (over: Partial<AutoRestoreResult>): AutoRestoreResult => ({
	action: 'skip-no-backup',
	tableCountBefore: 0,
	tableCountAfter: null,
	durationMs: 1,
	...over,
})

describe('databaseHasData', () => {
	it('is true after a restore that produced tables', () => {
		expect(
			databaseHasData(
				outcomeWith({
					action: 'restore',
					tableCountBefore: 0,
					tableCountAfter: 4,
				}),
			),
		).toBe(true)
	})

	it('is true when the DB was already populated', () => {
		expect(
			databaseHasData(
				outcomeWith({
					action: 'skip-db-populated',
					tableCountBefore: 9,
				}),
			),
		).toBe(true)
	})

	it('is false on a fresh DB with no prior backup (no snapshot worth taking)', () => {
		expect(databaseHasData(outcomeWith({ action: 'skip-no-backup' }))).toBe(
			false,
		)
	})
})
