import type { Client, SFTPWrapper } from 'ssh2'
import { Client as Ssh2Client } from 'ssh2'

import type { SshSession, SshSessionConfig } from './ssh-session.types.ts'

const DEFAULT_PORT = 22

function openSftp(conn: Client): Promise<SFTPWrapper> {
	return new Promise((resolve, reject) => {
		conn.sftp((err, sftp) => {
			if (err) {
				reject(
					new Error(`SSH sftp session failed: ${err.message}`, {
						cause: err,
					}),
				)
				return
			}
			resolve(sftp)
		})
	})
}

export async function createSshSession(
	config: SshSessionConfig,
	injectedClient?: Client,
): Promise<SshSession> {
	const conn = injectedClient ?? new Ssh2Client()

	await new Promise<void>((resolve, reject) => {
		conn.on('ready', () => resolve())
		conn.on('error', (err: Error) =>
			reject(
				new Error(
					`SSH connection to ${config.host} failed: ${err.message}`,
					{ cause: err },
				),
			),
		)
		conn.connect({
			host: config.host,
			port: config.port ?? DEFAULT_PORT,
			username: config.username,
			privateKey: config.privateKey,
		})
	})

	return {
		exec(command: string): Promise<string> {
			return new Promise((resolve, reject) => {
				conn.exec(command, (err, stream) => {
					if (err) {
						reject(
							new Error(`SSH exec failed: ${err.message}`, {
								cause: err,
							}),
						)
						return
					}
					let stdout = ''
					let stderr = ''
					stream.on('data', (data: Buffer) => {
						stdout += String(data)
					})
					stream.stderr.on('data', (data: Buffer) => {
						stderr += String(data)
					})
					stream.on('close', (code: number | null) => {
						if (code !== 0) {
							reject(
								new Error(
									`SSH command exited with code ${String(code)}: ${command}\n${stderr}`,
								),
							)
						} else {
							resolve(stdout)
						}
					})
				})
			})
		},

		async writeFile(remotePath: string, content: string): Promise<void> {
			const sftp = await openSftp(conn)
			return new Promise((resolve, reject) => {
				const ws = sftp.createWriteStream(remotePath)
				ws.on('close', () => resolve())
				ws.on('error', (writeErr: Error) =>
					reject(
						new Error(
							`SSH writeFile "${remotePath}" failed: ${writeErr.message}`,
							{ cause: writeErr },
						),
					),
				)
				ws.end(content)
			})
		},

		async readFile(remotePath: string): Promise<string> {
			const sftp = await openSftp(conn)
			return new Promise((resolve, reject) => {
				let content = ''
				const rs = sftp.createReadStream(remotePath, {
					encoding: 'utf8',
				})
				rs.on('data', (chunk: Buffer | string) => {
					content += String(chunk)
				})
				rs.on('end', () => resolve(content))
				rs.on('error', (readErr: Error) =>
					reject(
						new Error(
							`SSH readFile "${remotePath}" failed: ${readErr.message}`,
							{ cause: readErr },
						),
					),
				)
			})
		},

		close(): void {
			conn.end()
		},
	}
}
