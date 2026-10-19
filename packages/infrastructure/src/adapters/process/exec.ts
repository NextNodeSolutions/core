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
			child.stdin?.on('error', error => {
				if (!isClosedPipe(error)) reject(error)
			})
			child.stdin?.end(options.stdin)
		}
	})
}

// A child that exits before reading all of its input closes the pipe. Its exit
// code and stderr then say why, so the write error carries nothing more.
function isClosedPipe(error: Error): boolean {
	return 'code' in error && error.code === 'EPIPE'
}
