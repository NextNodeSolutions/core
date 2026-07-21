import { execFile } from 'node:child_process'

import { createLogger } from '@nextnode-solutions/logger'

import type { ExecFileException } from 'node:child_process'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'

const logger = createLogger()

const MS_PER_SECOND = 1_000

// A single `wrangler delete`/`deploy` against the Cloudflare API is quick, but
// npx may first download the wrangler package; the bound only exists to kill a
// genuinely hung process rather than block the CI job forever.
export const WRANGLER_TIMEOUT_MS = 300_000

const WRANGLER_MAX_BUFFER_BYTES = 67_108_864

// wrangler wraps a missing-script API failure as `workers.api.error.script_not_found`
// (`[code: 10007]`); either fingerprint means the Worker is already gone.
const SCRIPT_NOT_FOUND_FINGERPRINTS = [
	'workers.api.error.script_not_found',
	'[code: 10007]',
]

export interface ExecResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export function assertWranglerOk(exec: ExecResult, label: string): void {
	if (exec.exitCode !== 0) {
		throw new Error(
			`wrangler ${label} failed (exit ${String(exec.exitCode)}):\n${exec.stderr}`,
		)
	}
}

export interface WranglerRunnerOptions {
	readonly cwd?: string
	readonly stdin?: string
}

export interface WranglerRunner {
	(
		args: ReadonlyArray<string>,
		options?: WranglerRunnerOptions,
	): Promise<ExecResult>
}

function timeoutMessage(args: ReadonlyArray<string>): string {
	return `wrangler ${args.join(' ')} timed out after ${String(WRANGLER_TIMEOUT_MS / MS_PER_SECOND)}s and was killed - a hung run usually means an unreachable Cloudflare API; retry`
}

// Auth is ambient: wrangler reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
// from the forwarded process env, never from argv (a token in argv leaks to
// `ps` and CI logs). `npx --yes` resolves the project's local wrangler
// devDependency first, falling back to a one-off download.
export const defaultWranglerRunner: WranglerRunner = (args, options) =>
	new Promise<ExecResult>((resolve, reject) => {
		const child = execFile(
			'npx',
			['--yes', 'wrangler', ...args],
			{
				cwd: options?.cwd,
				env: process.env,
				encoding: 'utf8',
				maxBuffer: WRANGLER_MAX_BUFFER_BYTES,
				timeout: WRANGLER_TIMEOUT_MS,
				killSignal: 'SIGKILL',
			},
			(error: ExecFileException | null, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr })
					return
				}
				if (error.killed === true) {
					reject(new Error(timeoutMessage(args)))
					return
				}
				if (typeof error.code !== 'number') {
					reject(error)
					return
				}
				resolve({ exitCode: error.code, stdout, stderr })
			},
		)
		if (options?.stdin !== undefined) {
			child.stdin?.end(options.stdin)
		}
	})

/**
 * Delete a deployed Worker script by name. `--force` skips wrangler's
 * interactive confirmation (and its Durable-Objects prompt) so the command
 * never hangs in CI. A missing script is a valid teardown state, not a failure:
 * wrangler errors with `script_not_found`, which we map to
 * `{ handled: false, detail: 'already gone' }` - the same "already gone"
 * contract the Pages teardown uses. Any other non-zero exit throws the wrangler
 * stderr verbatim.
 */
export async function wranglerDelete(
	workerName: string,
	runner: WranglerRunner,
): Promise<ResourceOutcome> {
	const deletion = await runner(['delete', '--name', workerName, '--force'])
	if (deletion.exitCode === 0) {
		logger.info(`Worker "${workerName}" deleted`)
		return { handled: true, detail: `deleted "${workerName}"` }
	}

	const isAlreadyGone = SCRIPT_NOT_FOUND_FINGERPRINTS.some(fingerprint =>
		deletion.stderr.includes(fingerprint),
	)
	if (isAlreadyGone) {
		logger.info(`Worker "${workerName}" already gone`)
		return { handled: false, detail: `already gone "${workerName}"` }
	}

	throw new Error(
		`wrangler delete --name ${workerName} failed (exit ${String(deletion.exitCode)}):\n${deletion.stderr}`,
	)
}
