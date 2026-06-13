import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Inputs for the auto-restore step that rehydrates a freshly-provisioned
 * embedded postgres from the latest R2 dump before the pre-migrate
 * snapshot + forward-only migration. The orchestration knows project +
 * environment; the silo and compose-file path are derived inside the
 * adapter (the domain stays free of infra strings).
 *
 * `snapshotCount` is the number of dump snapshots the CLI listed from the
 * project's R2 backup bucket BEFORE the call. It is passed in (not listed
 * inside the hetzner adapter) because the strict layering bans
 * cross-adapter calls - listing R2 lives in the cli/r2 layer. Zero on a
 * genuine first-ever deploy; greater than zero once any backup exists
 * (including a prior deploy's pre-migrate snapshot).
 */
export interface AutoRestoreInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly snapshotCount: number
}

/**
 * What the auto-restore step decided to do:
 *   - `restore`            the DB is empty AND a prior dump exists -> rehydrate
 *   - `skip-db-populated`  the DB already holds data -> never overwrite it
 *   - `skip-no-backup`     fresh DB with no prior dump -> genuine first deploy
 */
export type AutoRestoreAction =
	| 'restore'
	| 'skip-db-populated'
	| 'skip-no-backup'

export interface AutoRestoreResult {
	readonly action: AutoRestoreAction
	readonly tableCountBefore: number
	// Re-probed user-table count after a restore; `null` when no restore ran
	// (one of the skip actions).
	readonly tableCountAfter: number | null
	readonly durationMs: number
}

/**
 * The whole safety of auto-restore rests here. `restore.sh` runs
 * `pg_restore --clean --if-exists`, which DROPS existing objects before
 * recreating them - catastrophic against a populated database. So we only
 * ever restore when the database is provably empty (zero user tables) AND a
 * dump actually exists to restore from. Any populated database short-
 * circuits to `skip-db-populated`; an empty database with no dump is a real
 * first deploy and proceeds empty (`skip-no-backup`).
 *
 * Pure: a count and a count in, a decision out. The IO that produces the
 * counts (an SSH `psql` probe, an R2 listing) lives in the adapters/cli.
 */
export function planAutoRestore(args: {
	readonly tableCountBefore: number
	readonly snapshotCount: number
}): AutoRestoreAction {
	if (args.tableCountBefore > 0) return 'skip-db-populated'
	if (args.snapshotCount <= 0) return 'skip-no-backup'
	return 'restore'
}

/**
 * Parse the single integer a `psql -tAc 'SELECT count(*) ...'` probe prints
 * to stdout. `-tA` strips the header, the row borders and the alignment, so
 * a well-formed result is exactly the number followed by a newline. Strict
 * on purpose: anything that is not a bare integer (a NOTICE leaked onto
 * stdout, an empty result, a connection error printed before psql failed)
 * must NOT be silently read as `0`, because a spurious `0` would green-light
 * a destructive restore. We reject rather than guess.
 */
export function parsePsqlTableCount(stdout: string): number {
	const trimmed = stdout.trim()
	const tableCount = Number.parseInt(trimmed, 10)
	if (!Number.isInteger(tableCount) || String(tableCount) !== trimmed) {
		throw new Error(
			`auto-restore: expected a single integer table count from the psql probe, got ${JSON.stringify(stdout)}`,
		)
	}
	return tableCount
}

/**
 * Fail-loud post-condition. `restore.sh` omits `set -e` on purpose
 * (upstream comment: "i can't remember why exactly"), so a mid-restore
 * failure - a missing dump, a pg_restore error - can leave the script
 * exiting 0 despite restoring nothing. We only call restore when a dump is
 * KNOWN to exist, so a still-empty database afterwards means the restore
 * genuinely failed and the VPS was NOT rehydrated. Throwing here halts the
 * deploy before migrate papers over the loss with a fresh schema.
 */
export function assertDbPopulatedAfterRestore(tableCountAfter: number): void {
	if (tableCountAfter > 0) return
	throw new Error(
		'auto-restore: the database is still empty after restoring the latest R2 dump. restore.sh reported success but created no tables (the image omits `set -e`, so its exit code is unreliable). The VPS was NOT rehydrated - inspect the postgres-backup container logs before retrying.',
	)
}

/**
 * Does the database hold real data once the auto-restore step settled? Drives
 * whether the caller bothers taking a pre-migrate snapshot: an EMPTY database
 * (genuine first deploy with no prior dump) has nothing to roll back to, and
 * snapshotting it would upload an empty dump that a later retry could wrongly
 * pick up as a restore candidate - then restore into the still-empty DB and
 * trip `assertDbPopulatedAfterRestore`, failing the retry for no reason. So
 * we only snapshot when there is data worth protecting.
 *
 * Final count = the post-restore probe when a restore ran, else the pre-probe
 * (a `skip-db-populated` keeps `tableCountAfter` null but `tableCountBefore`
 * is already > 0).
 */
export function databaseHasData(outcome: AutoRestoreResult): boolean {
	const finalCount = outcome.tableCountAfter ?? outcome.tableCountBefore
	return finalCount > 0
}
