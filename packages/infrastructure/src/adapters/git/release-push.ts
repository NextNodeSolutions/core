import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const MAX_ATTEMPTS = 5

function git(args: ReadonlyArray<string>, cwd: string): string {
	return execFileSync('git', [...args], {
		cwd,
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'inherit'],
	}).trim()
}

function rebaseInProgress(repoRoot: string): boolean {
	return (
		existsSync(join(repoRoot, '.git/rebase-merge')) ||
		existsSync(join(repoRoot, '.git/rebase-apply'))
	)
}

export interface RecoverPushInput {
	readonly repoRoot: string
	readonly branch: string
}

export function recoverReleasePush({
	repoRoot,
	branch,
}: RecoverPushInput): void {
	const tagOutput = git(['tag', '--points-at', 'HEAD'], repoRoot)
	const [tagName, ...extraTags] = tagOutput.split('\n').filter(Boolean)
	if (!tagName) {
		throw new Error('No tag points at HEAD — nothing to recover')
	}
	if (extraTags.length > 0) {
		throw new Error(
			`Multiple tags point at HEAD (${[tagName, ...extraTags].join(', ')}) — ambiguous recovery`,
		)
	}

	let lastError: unknown
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			git(['fetch', 'origin', branch], repoRoot)
			git(['rebase', `origin/${branch}`], repoRoot)
			git(['tag', '-f', tagName, 'HEAD'], repoRoot)
			git(['push', 'origin', `HEAD:${branch}`], repoRoot)
			git(['push', 'origin', '--force', `refs/tags/${tagName}`], repoRoot)
			return
		} catch (error) {
			lastError = error
			if (rebaseInProgress(repoRoot)) {
				try {
					git(['rebase', '--abort'], repoRoot)
				} catch (abortError) {
					logger.warn(
						`rebase --abort failed on attempt ${attempt}: ${abortError instanceof Error ? abortError.message : String(abortError)}`,
					)
				}
			}
		}
	}
	throw new Error(
		`Failed to recover release push after ${MAX_ATTEMPTS} attempts`,
		{ cause: lastError },
	)
}
