export interface SshSession {
	readonly exec: (command: string) => Promise<string>
	readonly execWithStdin: (command: string, stdin: string) => Promise<string>
	readonly writeFile: (remotePath: string, content: string) => Promise<void>
	readonly readFile: (remotePath: string) => Promise<string | null>
	readonly close: () => void
}

export interface SshSessionConfig {
	readonly host: string
	readonly port?: number
	readonly username: string
	readonly privateKey: string | Buffer
}
