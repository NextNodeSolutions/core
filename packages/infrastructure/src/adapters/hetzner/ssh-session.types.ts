export interface SshSession {
	readonly exec: (command: string) => Promise<string>
	readonly writeFile: (remotePath: string, content: string) => Promise<void>
	readonly readFile: (remotePath: string) => Promise<string>
	readonly close: () => void
}

export interface SshSessionConfig {
	readonly host: string
	readonly port?: number
	readonly username: string
	readonly privateKey: string | Buffer
}
