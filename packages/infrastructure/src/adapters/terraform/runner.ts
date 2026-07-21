import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ExecFileException } from 'node:child_process'
import type { TerraformMainConfig } from '#/domain/cloudflare/workers/terraform-config.ts'

const logger = createLogger()

const MS_PER_SECOND = 1_000

// A `terraform apply` against Cloudflare can run for minutes (15 min); the bound
// only exists to kill a genuinely hung process (held lock, unreachable provider
// API) rather than block the CI job forever.
export const TERRAFORM_TIMEOUT_MS = 900_000

// Bounded wait for the HCP state lock. Terraform blocks up to this long for a
// concurrent run to release the lock before failing instead of erroring at once.
export const TERRAFORM_LOCK_TIMEOUT = '5m'

const TERRAFORM_MAX_BUFFER_BYTES = 67_108_864
const TERRAFORM_CONFIG_FILENAME = 'main.tf.json'
const TERRAFORM_CONFIG_INDENT = 2
const STATE_LOCK_FINGERPRINT = 'Error acquiring the state lock'

// `terraform plan -detailed-exitcode` splits success into two codes: 0 = no
// diff, 2 = a diff is pending. Every other code is a genuine failure. Both 0
// and 2 carry the human-readable plan on stdout.
const TERRAFORM_PLAN_NO_CHANGES_EXIT = 0
const TERRAFORM_PLAN_CHANGES_EXIT = 2

export interface ExecResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export interface TerraformRunnerOptions {
	readonly cwd?: string
	readonly env?: Readonly<Record<string, string>>
}

export interface TerraformRunner {
	(
		args: ReadonlyArray<string>,
		options?: TerraformRunnerOptions,
	): Promise<ExecResult>
}

function timeoutMessage(args: ReadonlyArray<string>): string {
	return `terraform ${args.join(' ')} timed out after ${String(TERRAFORM_TIMEOUT_MS / MS_PER_SECOND)}s and was killed - a hung run usually means a held state lock or an unreachable provider API; inspect the run in HCP Terraform and retry`
}

export const defaultTerraformRunner: TerraformRunner = (args, options) =>
	new Promise<ExecResult>((resolve, reject) => {
		execFile(
			'terraform',
			[...args],
			{
				cwd: options?.cwd,
				env: { ...process.env, ...options?.env },
				encoding: 'utf8',
				maxBuffer: TERRAFORM_MAX_BUFFER_BYTES,
				timeout: TERRAFORM_TIMEOUT_MS,
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
	})

/**
 * Write the `main.tf.json` config into `workdir` and return its path. Pure IO:
 * the object is produced by the domain (`buildTerraformMainConfig`); this only
 * serialises and persists it. Kept in the adapter so the target can hand a
 * freshly-computed config to a scratch workdir without touching the fs itself.
 */
export async function writeTerraformConfig(
	workdir: string,
	mainConfig: TerraformMainConfig,
): Promise<string> {
	const path = join(workdir, TERRAFORM_CONFIG_FILENAME)
	await writeFile(
		path,
		JSON.stringify(mainConfig, null, TERRAFORM_CONFIG_INDENT),
	)
	return path
}

function formatFailure(command: string, execResult: ExecResult): string {
	const output =
		execResult.stdout.trim().length > 0
			? `${execResult.stderr}\n\nstdout:\n${execResult.stdout}`
			: execResult.stderr
	const base = `terraform ${command} failed (exit ${String(execResult.exitCode)}):\n${output}`
	if (!execResult.stderr.includes(STATE_LOCK_FINGERPRINT)) return base
	return `${base}\n\nThe Terraform state lock is held by another run (see the Lock Info above). The wait was already bounded by -lock-timeout=${TERRAFORM_LOCK_TIMEOUT}. If no run is actually active, release it with \`terraform force-unlock <LOCK_ID>\` from this workspace.`
}

async function runTerraformCommand(
	args: ReadonlyArray<string>,
	workdir: string,
	runner: TerraformRunner,
	env: Readonly<Record<string, string>>,
): Promise<ExecResult> {
	const command = args[0] ?? 'terraform'
	const startedAt = Date.now()
	logger.info(`terraform ${command} started in "${workdir}"`)
	const execResult = await runner(args, { cwd: workdir, env })
	if (execResult.exitCode !== 0) {
		throw new Error(formatFailure(command, execResult))
	}
	logger.info(
		`terraform ${command} completed in ${String(Date.now() - startedAt)}ms`,
	)
	return execResult
}

function tfVarEnv(
	vars: Readonly<Record<string, string>>,
): Record<string, string> {
	const env: Record<string, string> = {}
	for (const [name, value] of Object.entries(vars)) {
		env[`TF_VAR_${name}`] = value
	}
	return env
}

export async function terraformInit(
	workdir: string,
	runner: TerraformRunner,
): Promise<void> {
	await runTerraformCommand(
		['init', '-input=false', '-no-color'],
		workdir,
		runner,
		{},
	)
}

export async function terraformApply(
	workdir: string,
	runner: TerraformRunner,
	vars: Readonly<Record<string, string>>,
): Promise<void> {
	await runTerraformCommand(
		[
			'apply',
			'-input=false',
			'-no-color',
			'-auto-approve',
			`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
		],
		workdir,
		runner,
		tfVarEnv(vars),
	)
}

export async function terraformDestroy(
	workdir: string,
	runner: TerraformRunner,
	vars: Readonly<Record<string, string>>,
): Promise<void> {
	await runTerraformCommand(
		[
			'destroy',
			'-input=false',
			'-no-color',
			'-auto-approve',
			`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
		],
		workdir,
		runner,
		tfVarEnv(vars),
	)
}

export interface TerraformPlanResult {
	readonly hasChanges: boolean
	readonly planText: string
}

export async function terraformPlan(
	workdir: string,
	runner: TerraformRunner,
	vars: Readonly<Record<string, string>>,
): Promise<TerraformPlanResult> {
	const startedAt = Date.now()
	logger.info(`terraform plan started in "${workdir}"`)
	const execResult = await runner(
		[
			'plan',
			'-input=false',
			'-no-color',
			`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
			'-detailed-exitcode',
		],
		{ cwd: workdir, env: tfVarEnv(vars) },
	)
	if (
		execResult.exitCode !== TERRAFORM_PLAN_NO_CHANGES_EXIT &&
		execResult.exitCode !== TERRAFORM_PLAN_CHANGES_EXIT
	) {
		throw new Error(formatFailure('plan', execResult))
	}
	logger.info(
		`terraform plan completed in ${String(Date.now() - startedAt)}ms`,
	)
	return {
		hasChanges: execResult.exitCode === TERRAFORM_PLAN_CHANGES_EXIT,
		planText: execResult.stdout,
	}
}

export async function terraformOutputJson(
	workdir: string,
	runner: TerraformRunner,
): Promise<Record<string, unknown>> {
	const outputExec = await runTerraformCommand(
		['output', '-json'],
		workdir,
		runner,
		{},
	)
	const parsed = parseJsonOrThrow(outputExec.stdout, 'terraform output -json')
	if (!isRecord(parsed)) {
		throw new Error(
			`terraform output -json: expected a JSON object, got ${typeof parsed}`,
		)
	}
	return parsed
}
