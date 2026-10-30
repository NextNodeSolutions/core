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

// Wrangler reports a missing Worker as script_not_found (10007) or, for a
// missing service, code 10090. Both mean teardown has nothing left to delete.
const SCRIPT_NOT_FOUND_FINGERPRINTS = [
	'workers.api.error.script_not_found',
	'[code: 10007]',
	'[code: 10090]',
]

// Cloudflare rejects an under-scoped or wrong-account token with API error 10000
// ("Authentication error"). On the first-ever Workers deploy this is the token
// missing Workers permissions rather than an invalid token.
const AUTH_ERROR_FINGERPRINT = '[code: 10000]'

// The Containers API answers a refused request with a bare "Unauthorized", both
// when the token lacks the Containers permission and when the account is not on
// the Workers Paid plan, the only plan that runs containers.
const CONTAINERS_UNAUTHORIZED_FINGERPRINT = 'Unauthorized'
const CONTAINERS_LABEL_PREFIX = 'containers'

export interface ExecResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

// Wrangler prints the error of a `--json` command to stdout, as
// `{"error": ...}`, while stderr carries pnpm's install progress: a failure
// message keeps both streams.
function failureOutput(exec: ExecResult): string {
	return [exec.stderr.trim(), exec.stdout.trim()]
		.filter(stream => stream.length > 0)
		.join('\n')
}

export function assertWranglerOk(exec: ExecResult, label: string): void {
	if (exec.exitCode === 0) return
	const output = failureOutput(exec)
	const base = `wrangler ${label} failed (exit ${String(exec.exitCode)}):\n${output}`
	if (output.includes(AUTH_ERROR_FINGERPRINT)) {
		throw new Error(
			`${base}\n\nCloudflare rejected the request as unauthorized (code 10000). CLOUDFLARE_API_TOKEN needs Workers permissions - at minimum Account > Workers Scripts: Edit and Account Settings: Read, plus Zone > Workers Routes: Edit, DNS: Edit and Zone: Read on each routed zone for the custom-domain routes, and Account > Workers Containers: Edit for a container service. Also confirm the token belongs to the CLOUDFLARE_ACCOUNT_ID account.`,
		)
	}
	if (
		label.startsWith(CONTAINERS_LABEL_PREFIX) &&
		output.includes(CONTAINERS_UNAUTHORIZED_FINGERPRINT)
	) {
		throw new Error(
			`${base}\n\nCloudflare refused the Containers request. Containers run only on an account with the Workers Paid plan, so check the plan of the CLOUDFLARE_ACCOUNT_ID account first. CLOUDFLARE_API_TOKEN also needs Account > Workers Containers: Edit.`,
		)
	}
	throw new Error(base)
}

export interface WranglerRunnerOptions {
	readonly cwd?: string
	readonly stdin?: string
	// Overrides WRANGLER_TIMEOUT_MS for a command that moves more than API
	// calls, such as an image push.
	readonly timeoutMs?: number
}

export interface WranglerRunner {
	(
		args: ReadonlyArray<string>,
		options?: WranglerRunnerOptions,
	): Promise<ExecResult>
}

function timeoutMessage(
	args: ReadonlyArray<string>,
	timeoutMs: number,
): string {
	return `wrangler ${args.join(' ')} timed out after ${String(timeoutMs / MS_PER_SECOND)}s and was killed - a hung run usually means an unreachable Cloudflare API; retry`
}

// Auth is ambient: wrangler reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
// from the forwarded process env, never from argv (a token in argv leaks to
// `ps` and CI logs). `pnpm dlx wrangler` resolves the CLI in an isolated
// temporary environment without relying on npm's npx cache PATH.
export const defaultWranglerRunner: WranglerRunner = (args, options) =>
	new Promise<ExecResult>((resolve, reject) => {
		const timeoutMs = options?.timeoutMs ?? WRANGLER_TIMEOUT_MS
		const child = execFile(
			'pnpm',
			['dlx', 'wrangler', ...args],
			{
				cwd: options?.cwd,
				env: process.env,
				encoding: 'utf8',
				maxBuffer: WRANGLER_MAX_BUFFER_BYTES,
				timeout: timeoutMs,
				killSignal: 'SIGKILL',
			},
			(error: ExecFileException | null, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr })
					return
				}
				if (error.killed === true) {
					reject(new Error(timeoutMessage(args, timeoutMs)))
					return
				}
				if (typeof error.code !== 'number') {
					reject(error)
					return
				}
				resolve({ exitCode: error.code, stdout, stderr })
			},
		)
		if (typeof options?.stdin !== 'undefined') {
			child.stdin?.end(options.stdin)
		}
	})

/**
 * Delete a deployed Worker script by name. `--force` skips wrangler's
 * interactive confirmation (and its Durable-Objects prompt) so the command
 * never hangs in CI. A missing script is a valid teardown state, not a failure:
 * wrangler errors with `script_not_found` or code 10090, which we map to
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
