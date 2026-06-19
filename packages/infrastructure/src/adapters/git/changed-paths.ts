import { execFileSync } from 'node:child_process'

/**
 * The repo-relative paths that differ between two commits, via
 * `git diff --name-only base head`. Runs in `cwd` (the checked-out caller
 * repo, with full history). Throws when either ref is unknown - e.g. a shallow
 * clone that does not contain the base commit - so the caller can fail safe.
 */
export function getChangedPaths(
	baseRef: string,
	headRef: string,
	cwd: string,
): ReadonlyArray<string> {
	const stdout = execFileSync(
		'git',
		['diff', '--name-only', baseRef, headRef],
		{ cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
	return stdout.split('\n').filter(Boolean)
}
