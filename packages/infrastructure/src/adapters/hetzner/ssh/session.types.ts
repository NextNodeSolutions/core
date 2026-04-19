export interface SshSession {
	readonly exec: (command: string) => Promise<string>
	readonly execWithStdin: (command: string, stdin: string) => Promise<string>
	readonly writeFile: (remotePath: string, content: string) => Promise<void>
	readonly readFile: (remotePath: string) => Promise<string | null>
	readonly close: () => void
	/** SHA-256 hex fingerprint of the remote host public key observed at connect time. */
	readonly hostKeyFingerprint: string
}

export interface SshSessionConfig {
	readonly host: string
	readonly port?: number
	readonly username: string
	readonly privateKey: string | Buffer
	/**
	 * SHA-256 hex fingerprint of the expected remote host key. When provided,
	 * the connection is rejected on mismatch (timing-safe compare). When
	 * undefined, the first observed key is accepted (TOFU) and exposed via
	 * `SshSession.hostKeyFingerprint` so the caller can persist it.
	 */
	readonly expectedHostKeyFingerprint?: string | undefined
}
