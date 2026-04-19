import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

import type { Client, SFTPWrapper } from 'ssh2'
import { Client as Ssh2Client } from 'ssh2'

import type { SshSession, SshSessionConfig } from './session.types.ts'

const DEFAULT_PORT = 22

// RFC 4251 §9.1 — SFTP SSH_FX_NO_SUCH_FILE status code.
const SFTP_STATUS_NO_SUCH_FILE = 2

interface SftpError extends Error {
	readonly code?: number | string
}

function isNotFoundError(err: SftpError): boolean {
	return err.code === SFTP_STATUS_NO_SUCH_FILE || err.code === 'ENOENT'
}

function computeHostKeyFingerprint(key: Buffer): string {
	return createHash('sha256').update(key).digest('hex')
}

function fingerprintsMatch(observed: string, expected: string): boolean {
	const a = Buffer.from(observed, 'hex')
	const b = Buffer.from(expected, 'hex')
	if (a.length !== b.length || a.length === 0) return false
	return timingSafeEqual(a, b)
}

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
	let observedFingerprint: string | undefined

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
			hostVerifier: (key: Buffer): boolean => {
				const fingerprint = computeHostKeyFingerprint(key)
				observedFingerprint = fingerprint
				if (config.expectedHostKeyFingerprint === undefined) {
					// TOFU: first-time connect. Caller will persist the
					// fingerprint after this session is returned.
					return true
				}
				return fingerprintsMatch(
					fingerprint,
					config.expectedHostKeyFingerprint,
				)
			},
		})
	})

	if (observedFingerprint === undefined) {
		// hostVerifier is always invoked during a real handshake; missing
		// means the injected client skipped verification (test-only path).
		throw new Error(
			`SSH connection to ${config.host} completed without observing a host key`,
		)
	}
	const hostKeyFingerprint = observedFingerprint

	function runCommand(
		command: string,
		stdin: string | null,
	): Promise<string> {
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
				if (stdin !== null) {
					stream.end(stdin)
				}
			})
		})
	}

	return {
		exec(command: string): Promise<string> {
			return runCommand(command, null)
		},

		execWithStdin(command: string, stdin: string): Promise<string> {
			return runCommand(command, stdin)
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

		async readFile(remotePath: string): Promise<string | null> {
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
				rs.on('error', (readErr: SftpError) => {
					if (isNotFoundError(readErr)) {
						resolve(null)
						return
					}
					reject(
						new Error(
							`SSH readFile "${remotePath}" failed: ${readErr.message}`,
							{ cause: readErr },
						),
					)
				})
			})
		},

		close(): void {
			conn.end()
		},

		hostKeyFingerprint,
	}
}
