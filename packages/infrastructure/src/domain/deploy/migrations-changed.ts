import type { PostgresServiceConfig } from '#/config/types.ts'

// drizzle-kit's own default `out` directory. A postgres project that does not
// override `migrations_folder` ships its generated SQL here.
const DEFAULT_MIGRATIONS_FOLDER = 'drizzle'

/**
 * The directory (relative to the project root) holding generated migration
 * files. Used to decide whether a given push touched the schema, so the
 * migrate job can be skipped when it did not.
 */
export function resolveMigrationsFolder(
	postgres: PostgresServiceConfig | undefined,
): string {
	return postgres?.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER
}

// The set of paths a push changed, or a signal that we could not compute it.
// "undiffable" covers every case where a reliable diff is impossible - a manual
// dispatch (no base commit), a first push (zero base ref), or a shallow clone
// that cannot resolve the base. In all of these we must NOT trust an empty diff.
export type MigrationsDiff =
	| { readonly kind: 'paths'; readonly changedPaths: ReadonlyArray<string> }
	| { readonly kind: 'undiffable'; readonly reason: string }

export interface MigrationsChangedDecision {
	readonly changed: boolean
	readonly reason: string
}

/**
 * Decide whether a push changed any migration file. Fails SAFE: when the diff
 * is undiffable we report `changed` so the migrate job still runs - deploying
 * an app against an unmigrated schema is far worse than paying for one extra
 * migrate roundtrip.
 */
export function decideMigrationsChanged(
	diff: MigrationsDiff,
	migrationsFolder: string,
): MigrationsChangedDecision {
	if (diff.kind === 'undiffable') {
		return { changed: true, reason: `fail-safe: ${diff.reason}` }
	}

	const folderPrefix = `${migrationsFolder}/`
	const touched = diff.changedPaths.some(
		path => path === migrationsFolder || path.startsWith(folderPrefix),
	)
	return touched
		? {
				changed: true,
				reason: `migration files changed under ${folderPrefix}`,
			}
		: {
				changed: false,
				reason: `no migration files changed under ${folderPrefix}`,
			}
}
