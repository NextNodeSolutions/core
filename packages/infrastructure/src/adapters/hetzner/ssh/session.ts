import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

import { Client as Ssh2Client } from 'ssh2'

import type { Client, SFTPWrapper } from 'ssh2'
import type { SshSession, SshSessionConfig } from './session.types.ts'

const DEFAULT_PORT = 22

// RFC 4251 §9.1 - SFTP SSH_FX_NO_SUCH_FILE status code.
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

// Open the connection and run the host-key verification (TOFU on first
// connect, compare-and-fail thereafter). Resolves with the observed
// fingerprint once the handshake reaches `ready`.
function establishConnection(
	conn: Client,
	config: SshSessionConfig,
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let observedFingerprint: string | undefined
		conn.on('ready', () => {
			if (typeof observedFingerprint === 'undefined') {
				reject(
					new Error(
						`SSH connection to ${config.host} completed without observing a host key`,
					),
				)
				return
			}
			resolve(observedFingerprint)
		})
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
				if (typeof config.expectedHostKeyFingerprint === 'undefined')
					return true
				return fingerprintsMatch(
					fingerprint,
					config.expectedHostKeyFingerprint,
				)
			},
		})
	})
}

function execOverSsh(
	conn: Client,
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
			stream.on('data', (chunk: Buffer) => {
				stdout += String(chunk)
			})
			stream.stderr.on('data', (chunk: Buffer) => {
				stderr += String(chunk)
			})
			stream.on('close', (code: number | null) => {
				if (code === 0) {
					resolve(stdout)
				} else {
					reject(
						new Error(
							`SSH command exited with code ${String(code)}: ${command}\n${stderr}`,
						),
					)
				}
			})
			if (stdin !== null) stream.end(stdin)
		})
	})
}

async function writeFileOverSsh(
	conn: Client,
	remotePath: string,
	content: string,
): Promise<void> {
	// Each openSftp() opens a distinct SFTP channel; close it when done or the
	// channels accumulate and the SSH server refuses new ones once MaxSessions
	// is reached ("Channel open failure: open failed") mid-deploy.
	const sftp = await openSftp(conn)
	try {
		await new Promise<void>((resolve, reject) => {
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
	} finally {
		sftp.end()
	}
}

async function readFileOverSsh(
	conn: Client,
	remotePath: string,
): Promise<string | null> {
	// Close the SFTP channel when done (see writeFileOverSsh) to avoid leaking
	// channels until the server hits MaxSessions.
	const sftp = await openSftp(conn)
	try {
		return await new Promise<string | null>((resolve, reject) => {
			let content = ''
			const rs = sftp.createReadStream(remotePath, { encoding: 'utf8' })
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
	} finally {
		sftp.end()
	}
}

export async function createSshSession(
	config: SshSessionConfig,
	injectedClient?: Client,
): Promise<SshSession> {
	const conn = injectedClient ?? new Ssh2Client()
	const hostKeyFingerprint = await establishConnection(conn, config)

	return {
		exec: (command: string) => execOverSsh(conn, command, null),
		execWithStdin: (command: string, stdin: string) =>
			execOverSsh(conn, command, stdin),
		writeFile: (remotePath: string, content: string) =>
			writeFileOverSsh(conn, remotePath, content),
		readFile: (remotePath: string) => readFileOverSsh(conn, remotePath),
		close: (): void => {
			conn.end()
		},
		hostKeyFingerprint,
	}
}
