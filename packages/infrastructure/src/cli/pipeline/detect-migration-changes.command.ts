import { getChangedPaths } from '#/adapters/git/changed-paths.ts'
import { writeOutput } from '#/adapters/github/output.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import {
	decideMigrationsChanged,
	resolveMigrationsFolder,
} from '#/domain/deploy/migrations-changed.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { NextNodeConfig } from '#/config/types.ts'
import type { MigrationsDiff } from '#/domain/deploy/migrations-changed.ts'

const logger = createLogger()

// git's null object id: github.event.before on the first push to a branch.
const ZERO_SHA = /^0+$/

/**
 * Emit `migrations_changed` for the `migrate` job to gate on. A push that did
 * not touch the migrations folder skips the whole migrate job (its postgres
 * roundtrip is the per-deploy hotspot); the `deploy` job brings postgres up
 * independently, so the schema stays available - only its (no-op) migration is
 * skipped. Any range we cannot diff fails safe and runs the migration.
 */
export function detectMigrationChangesCommand(config: NextNodeConfig): void {
	const migrationsFolder = resolveMigrationsFolder(config.services)
	const decision = decideMigrationsChanged(
		resolveMigrationsDiff(),
		migrationsFolder,
	)

	logger.info(decision.reason)
	writeOutput('migrations_changed', String(decision.changed))
}

// Read the push range from the environment. Only a genuine push with a real
// base commit shells out to git; everything else (manual dispatch, zero base
// ref, a git failure on a shallow clone) is `undiffable` so the decision runs
// the migration rather than risk an unmigrated schema.
function resolveMigrationsDiff(): MigrationsDiff {
	const eventName = getEnv('GITHUB_EVENT_NAME')
	if (eventName !== 'push') {
		return {
			kind: 'undiffable',
			reason: `event "${eventName ?? 'unknown'}" is not a push`,
		}
	}

	const baseSha = getEnv('PIPELINE_BASE_SHA')
	if (!baseSha || ZERO_SHA.test(baseSha)) {
		return {
			kind: 'undiffable',
			reason: 'no base commit (new branch or first push)',
		}
	}

	const headSha = requireEnv('GITHUB_SHA')
	const workspace = getEnv('GITHUB_WORKSPACE') ?? process.cwd()
	try {
		return {
			kind: 'paths',
			changedPaths: getChangedPaths(baseSha, headSha, workspace),
		}
	} catch (error) {
		return {
			kind: 'undiffable',
			reason: `git diff failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
