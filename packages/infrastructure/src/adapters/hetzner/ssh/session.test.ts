import { EventEmitter } from 'node:events'

import { Client } from 'ssh2'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSshSession } from './session.ts'
import type { SshSession } from './session.types.ts'

const SESSION_CONFIG = {
	host: '10.0.0.1',
	username: 'deploy',
	privateKey: 'fake-key-content',
} as const

const mockExec = vi.fn()
const mockSftp = vi.fn()
const mockEnd = vi.fn()

let client: Client

beforeEach(() => {
	mockExec.mockReset()
	mockSftp.mockReset()
	mockEnd.mockReset()

	client = new Client()
	client.connect = vi.fn().mockImplementation(() => {
		process.nextTick(() => client.emit('ready'))
	})
	client.exec = mockExec
	client.sftp = mockSftp
	client.end = mockEnd
})

function createExecStream(
	stdout: string,
	stderr: string,
	exitCode: number,
): EventEmitter {
	const stream = new EventEmitter()
	const stderrEmitter = new EventEmitter()
	Object.defineProperty(stream, 'stderr', { value: stderrEmitter })
	process.nextTick(() => {
		if (stdout) stream.emit('data', Buffer.from(stdout))
		if (stderr) stderrEmitter.emit('data', Buffer.from(stderr))
		stream.emit('close', exitCode)
	})
	return stream
}

async function connectedSession(): Promise<SshSession> {
	return createSshSession(SESSION_CONFIG, client)
}

describe('createSshSession', () => {
	it('connects with the given config', async () => {
		await createSshSession(SESSION_CONFIG, client)

		expect(client.connect).toHaveBeenCalledWith(
			expect.objectContaining({
				host: '10.0.0.1',
				port: 22,
				username: 'deploy',
				privateKey: 'fake-key-content',
			}),
		)
	})

	it('rejects on connection error', async () => {
		client.connect = vi.fn().mockImplementation(() => {
			process.nextTick(() =>
				client.emit('error', new Error('connection refused')),
			)
		})

		await expect(createSshSession(SESSION_CONFIG, client)).rejects.toThrow(
			/SSH connection to 10\.0\.0\.1 failed.*connection refused/,
		)
	})
})

describe('exec', () => {
	it('returns stdout on success', async () => {
		const session = await connectedSession()
		mockExec.mockImplementation(
			(
				_cmd: string,
				cb: (err: undefined, stream: EventEmitter) => void,
			) => {
				cb(undefined, createExecStream('hello world\n', '', 0))
			},
		)

		const result = await session.exec('echo hello world')

		expect(result).toBe('hello world\n')
	})

	it('rejects with stderr on non-zero exit', async () => {
		const session = await connectedSession()
		mockExec.mockImplementation(
			(
				_cmd: string,
				cb: (err: undefined, stream: EventEmitter) => void,
			) => {
				cb(undefined, createExecStream('', 'not found\n', 1))
			},
		)

		await expect(session.exec('bad-command')).rejects.toThrow(
			/SSH command exited with code 1.*bad-command.*not found/s,
		)
	})

	it('rejects when exec callback receives error', async () => {
		const session = await connectedSession()
		mockExec.mockImplementation(
			(_cmd: string, cb: (err: Error) => void) => {
				cb(new Error('channel open failed'))
			},
		)

		await expect(session.exec('anything')).rejects.toThrow(
			/SSH exec failed.*channel open failed/,
		)
	})
})

describe('execWithStdin', () => {
	it('writes stdin to the remote stream and returns stdout', async () => {
		const session = await connectedSession()
		let streamEnded: string | undefined
		mockExec.mockImplementation(
			(
				_cmd: string,
				cb: (err: undefined, stream: EventEmitter) => void,
			) => {
				const stream = new EventEmitter()
				const stderrEmitter = new EventEmitter()
				Object.defineProperty(stream, 'stderr', {
					value: stderrEmitter,
				})
				Object.assign(stream, {
					end(data: string) {
						streamEnded = data
						process.nextTick(() => {
							stream.emit('data', Buffer.from('logged in\n'))
							stream.emit('close', 0)
						})
					},
				})
				cb(undefined, stream)
			},
		)

		const result = await session.execWithStdin(
			'docker login ghcr.io -u __token__ --password-stdin',
			'secret-token',
		)

		expect(streamEnded).toBe('secret-token')
		expect(result).toBe('logged in\n')
	})
})

describe('writeFile', () => {
	it('writes content via sftp stream', async () => {
		const session = await connectedSession()
		const written: Record<string, string> = {}

		mockSftp.mockImplementation(
			(cb: (err: undefined, sftp: unknown) => void) => {
				cb(undefined, {
					createWriteStream(path: string) {
						const ws = new EventEmitter()
						Object.assign(ws, {
							end(data: string) {
								written[path] = data
								process.nextTick(() => ws.emit('close'))
							},
						})
						return ws
					},
				})
			},
		)

		await session.writeFile('/opt/apps/config.yml', 'key: value')

		expect(written['/opt/apps/config.yml']).toBe('key: value')
	})

	it('rejects on sftp error', async () => {
		const session = await connectedSession()
		mockSftp.mockImplementation((cb: (err: Error) => void) => {
			cb(new Error('sftp subsystem denied'))
		})

		await expect(session.writeFile('/any', 'content')).rejects.toThrow(
			/SSH sftp session failed.*sftp subsystem denied/,
		)
	})
})

describe('readFile', () => {
	it('returns file content via sftp stream', async () => {
		const session = await connectedSession()

		mockSftp.mockImplementation(
			(cb: (err: undefined, sftp: unknown) => void) => {
				cb(undefined, {
					createReadStream() {
						const rs = new EventEmitter()
						process.nextTick(() => {
							rs.emit('data', 'file content here')
							rs.emit('end')
						})
						return rs
					},
				})
			},
		)

		const result = await session.readFile('/opt/apps/state.json')

		expect(result).toBe('file content here')
	})

	it('resolves null when the file does not exist (SFTP NO_SUCH_FILE)', async () => {
		const session = await connectedSession()

		mockSftp.mockImplementation(
			(cb: (err: undefined, sftp: unknown) => void) => {
				cb(undefined, {
					createReadStream() {
						const rs = new EventEmitter()
						process.nextTick(() => {
							const err = Object.assign(
								new Error('no such file'),
								{
									code: 2,
								},
							)
							rs.emit('error', err)
						})
						return rs
					},
				})
			},
		)

		await expect(session.readFile('/missing')).resolves.toBeNull()
	})

	it('resolves null when the error code is ENOENT', async () => {
		const session = await connectedSession()

		mockSftp.mockImplementation(
			(cb: (err: undefined, sftp: unknown) => void) => {
				cb(undefined, {
					createReadStream() {
						const rs = new EventEmitter()
						process.nextTick(() => {
							const err = Object.assign(
								new Error('no such file'),
								{
									code: 'ENOENT',
								},
							)
							rs.emit('error', err)
						})
						return rs
					},
				})
			},
		)

		await expect(session.readFile('/missing')).resolves.toBeNull()
	})

	it('rejects on a real read stream error (not NO_SUCH_FILE)', async () => {
		const session = await connectedSession()

		mockSftp.mockImplementation(
			(cb: (err: undefined, sftp: unknown) => void) => {
				cb(undefined, {
					createReadStream() {
						const rs = new EventEmitter()
						process.nextTick(() => {
							const err = Object.assign(
								new Error('permission denied'),
								{
									code: 3,
								},
							)
							rs.emit('error', err)
						})
						return rs
					},
				})
			},
		)

		await expect(session.readFile('/forbidden')).rejects.toThrow(
			/SSH readFile "\/forbidden" failed.*permission denied/,
		)
	})
})

describe('close', () => {
	it('calls end on the ssh2 client', async () => {
		const session = await connectedSession()

		session.close()

		expect(mockEnd).toHaveBeenCalledOnce()
	})
})
