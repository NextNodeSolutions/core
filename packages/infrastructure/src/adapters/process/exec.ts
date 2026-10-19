import { execFile } from 'node:child_process'

import type { ExecFileException } from 'node:child_process'

export interface ExecResult {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export interface BoundedExecOptions {
	readonly cwd?: string | undefined
	readonly env: NodeJS.ProcessEnv
	readonly stdin?: string | undefined
	readonly maxBufferBytes: number
	readonly timeoutMs: number
	readonly timeoutMessage: string
}

export function execBounded(
	file: string,
	args: ReadonlyArray<string>,
	options: BoundedExecOptions,
): Promise<ExecResult> {
	return new Promise<ExecResult>((resolve, reject) => {
		const child = execFile(
			file,
			[...args],
			{
				cwd: options.cwd,
				env: options.env,
				encoding: 'utf8',
				maxBuffer: options.maxBufferBytes,
				timeout: options.timeoutMs,
				killSignal: 'SIGKILL',
			},
			(error: ExecFileException | null, stdout, stderr) => {
				if (error === null) {
					resolve({ exitCode: 0, stdout, stderr })
					return
				}
				if (error.killed === true) {
					reject(new Error(options.timeoutMessage))
					return
				}
				if (typeof error.code !== 'number') {
					reject(error)
					return
				}
				resolve({ exitCode: error.code, stdout, stderr })
			},
		)
		if (typeof options.stdin !== 'undefined') {
			child.stdin?.end(options.stdin)
		}
	})
}
