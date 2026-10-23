import { CONTAINER_CONTROL_PREFIX, CONTAINER_PORT_VAR } from './contract.ts'

const LISTEN_HOST = '0.0.0.0'
const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2

// Vars and secrets reach the container as environment variables; core's
// control vars and the bindings stay in the gateway.
export function containerEnvVars(
	env: Readonly<Record<string, unknown>>,
	port: number,
): Record<string, string> {
	const forwarded: Record<string, string> = {}
	for (const [name, value] of Object.entries(env)) {
		if (
			typeof value !== 'string' ||
			name.startsWith(CONTAINER_CONTROL_PREFIX)
		)
			continue
		forwarded[name] = value
	}
	return { ...forwarded, PORT: String(port), HOST: LISTEN_HOST }
}

// SHA-256 of the image reference and the env sorted by name: what a running
// container was started with, compared without storing a value in clear.
export async function envDigest(
	envVars: Readonly<Record<string, string>>,
	image: string,
): Promise<string> {
	const sorted = Object.keys(envVars)
		.toSorted()
		.map(name => [name, envVars[name]])
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([image, sorted])),
	)
	return Array.from(new Uint8Array(digest), byte =>
		byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0'),
	).join('')
}

export function parsePort(raw: string): number {
	const port = Number(raw)
	if (!Number.isInteger(port))
		throw new Error(
			`${CONTAINER_PORT_VAR} must be an integer, got "${raw}"`,
		)
	return port
}
