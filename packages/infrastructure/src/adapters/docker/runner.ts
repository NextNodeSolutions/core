import { execFile } from 'node:child_process'

import type { ExecFileException } from 'node:child_process'
import type { ExecResult } from '#/adapters/wrangler/runner.ts'

const MS_PER_SECOND = 1_000

// Loading a saved image unpacks its layers into the local store; the bound
// kills a hung daemon call before the job's own limit does, so the log says
// why.
export const DOCKER_TIMEOUT_MS = 600_000

const DOCKER_MAX_BUFFER_BYTES = 67_108_864

export interface DockerRunner {
	(args: ReadonlyArray<string>): Promise<ExecResult>
}

function timeoutMessage(args: ReadonlyArray<string>): string {
	return `docker ${args.join(' ')} timed out after ${String(DOCKER_TIMEOUT_MS / MS_PER_SECOND)}s and was killed`
}

// The Docker CLI from PATH, preinstalled on GitHub's ubuntu runners. Like the
// wrangler runner, a non-zero exit resolves with its output so the caller
// decides; only a kill or a spawn failure rejects.
export const defaultDockerRunner: DockerRunner = args =>
	new Promise<ExecResult>((resolve, reject) => {
		execFile(
			'docker',
			args,
			{
				env: process.env,
				encoding: 'utf8',
				maxBuffer: DOCKER_MAX_BUFFER_BYTES,
				timeout: DOCKER_TIMEOUT_MS,
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
					reject(
						new Error(
							`docker could not start (${String(error.code)}) - this job needs the Docker CLI on PATH`,
							{ cause: error },
						),
					)
					return
				}
				resolve({ exitCode: error.code, stdout, stderr })
			},
		)
	})

/** Run one docker command and throw its stderr verbatim on a non-zero exit. */
export async function runDocker(
	args: ReadonlyArray<string>,
	runner: DockerRunner,
): Promise<ExecResult> {
	const exec = await runner(args)
	if (exec.exitCode === 0) return exec
	const [command] = args
	throw new Error(
		`docker ${command ?? ''} failed (exit ${String(exec.exitCode)}):\n${exec.stderr}`,
	)
}
