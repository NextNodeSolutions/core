import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CLOUDFLARE_CONTAINER_REGISTRY } from '#/domain/cloudflare/workers/container-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ExecFileException } from 'node:child_process'
import type { RegistryCredentials } from '#/adapters/cloudflare/containers/registry.ts'
import type { ExecResult } from '#/adapters/wrangler/runner.ts'

const logger = createLogger()

const MS_PER_SECOND = 1_000
// A push uploads every layer the registry lacks, which can take far longer
// than an API call; the bound kills a hung upload before the job's own limit
// does, so the log says why.
const SKOPEO_TIMEOUT_MS = 900_000
const SKOPEO_MAX_BUFFER_BYTES = 67_108_864
// Transient registry errors a copy retries on its own before failing.
const PUSH_RETRIES = '3'
const AUTH_DIR_PREFIX = 'nn-registry-auth-'
const AUTH_FILENAME = 'auth.json'
// Readable by the runner's user only, for the time of the push.
const AUTH_FILE_MODE = 0o600

export interface SkopeoRunner {
	(args: ReadonlyArray<string>): Promise<ExecResult>
}

function timeoutMessage(args: ReadonlyArray<string>): string {
	return `skopeo ${args.join(' ')} timed out after ${String(SKOPEO_TIMEOUT_MS / MS_PER_SECOND)}s and was killed`
}

// The skopeo CLI from PATH, preinstalled on GitHub's ubuntu runners. Like the
// wrangler runner, a non-zero exit resolves with its output so the caller
// decides; only a kill or a spawn failure rejects.
export const defaultSkopeoRunner: SkopeoRunner = args =>
	new Promise<ExecResult>((resolve, reject) => {
		execFile(
			'skopeo',
			args,
			{
				env: process.env,
				encoding: 'utf8',
				maxBuffer: SKOPEO_MAX_BUFFER_BYTES,
				timeout: SKOPEO_TIMEOUT_MS,
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
							`skopeo could not start (${String(error.code)}) - this job needs skopeo on PATH`,
							{ cause: error },
						),
					)
					return
				}
				resolve({ exitCode: error.code, stdout, stderr })
			},
		)
	})

// The login travels in a file skopeo reads, never in argv (a password in argv
// leaks to `ps` and CI logs). The file lives for the time of `run`.
async function withAuthFile<T>(
	credentials: RegistryCredentials,
	run: (authFile: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), AUTH_DIR_PREFIX))
	const authFile = join(dir, AUTH_FILENAME)
	const auth = Buffer.from(
		`${credentials.username}:${credentials.password}`,
	).toString('base64')
	try {
		await writeFile(
			authFile,
			JSON.stringify({
				auths: { [CLOUDFLARE_CONTAINER_REGISTRY]: { auth } },
			}),
			{ mode: AUTH_FILE_MODE },
		)
		return await run(authFile)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

export interface ImagePush {
	// The OCI archive the `containers` job saved.
	readonly archive: string
	// The full reference to push it as: `<registry>/<account>/<name>:<tag>`.
	readonly reference: string
}

/**
 * Push a saved OCI image archive to the registry straight from the file:
 * nothing is loaded into a daemon, and only the layers the registry lacks
 * are uploaded. The manifest goes up in the Docker schema 2 format the
 * registry serves to the platform, as `docker push` sends it.
 */
export async function pushImageArchive(
	push: ImagePush,
	credentials: RegistryCredentials,
	runner: SkopeoRunner,
): Promise<void> {
	logger.info(`Pushing ${push.reference}`)
	const exec = await withAuthFile(credentials, authFile =>
		runner([
			'copy',
			'--authfile',
			authFile,
			'--format',
			'v2s2',
			'--retry-times',
			PUSH_RETRIES,
			`oci-archive:${push.archive}`,
			`docker://${push.reference}`,
		]),
	)
	if (exec.exitCode === 0) {
		logger.info(`Pushed ${push.reference}`)
		return
	}
	throw new Error(
		`skopeo copy to ${push.reference} failed (exit ${String(exec.exitCode)}):\n${exec.stderr}`,
	)
}
