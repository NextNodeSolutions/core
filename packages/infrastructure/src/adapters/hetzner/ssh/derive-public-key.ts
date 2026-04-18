import ssh2 from 'ssh2'

const { utils: sshUtils } = ssh2

export function derivePublicKey(privateKeyPem: string): string {
	const parsed = sshUtils.parseKey(privateKeyPem)
	if (parsed instanceof Error) {
		throw new Error(`Failed to parse SSH private key: ${parsed.message}`, {
			cause: parsed,
		})
	}
	if (Array.isArray(parsed)) {
		throw new Error(
			`Expected a single SSH key but parseKey returned ${parsed.length}`,
		)
	}
	return `${parsed.type} ${parsed.getPublicSSH().toString('base64')}`
}
