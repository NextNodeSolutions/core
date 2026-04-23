import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { renderProjectCloudInit } from './cloud-init.ts'

const PROJECT_INPUT = {
	tailscaleAuthKey: 'tskey-auth-proj456',
	tailscaleHostname: 'my-project',
	deployPublicKey: 'ssh-ed25519 AAAAC3Nz... deploy@ci',
	internal: false,
} as const

const INTERNAL_PROJECT_INPUT = { ...PROJECT_INPUT, internal: true } as const

interface ProjectWriteFile {
	readonly path: string
	readonly content: string
	readonly permissions?: string
	readonly owner?: string
}

interface ProjectCloudInitConfig {
	readonly ssh_pwauth: boolean
	readonly disable_root: boolean
	readonly users: ReadonlyArray<{
		readonly name: string
		readonly ssh_authorized_keys: ReadonlyArray<string>
	}>
	readonly runcmd: ReadonlyArray<string>
	readonly write_files?: ReadonlyArray<ProjectWriteFile>
	readonly packages?: unknown
	readonly package_update?: unknown
}

function isProjectWriteFileArray(
	value: unknown,
): value is ReadonlyArray<ProjectWriteFile> {
	if (!Array.isArray(value)) return false
	return value.every(
		entry =>
			typeof entry === 'object' &&
			entry !== null &&
			'path' in entry &&
			typeof entry.path === 'string' &&
			'content' in entry &&
			typeof entry.content === 'string',
	)
}

function isProjectCloudInitConfig(
	value: unknown,
): value is ProjectCloudInitConfig {
	if (typeof value !== 'object' || value === null) return false
	return (
		'ssh_pwauth' in value &&
		'disable_root' in value &&
		'users' in value &&
		Array.isArray(value.users) &&
		'runcmd' in value &&
		Array.isArray(value.runcmd)
	)
}

function parseProjectCloudInit(
	input: typeof PROJECT_INPUT | typeof INTERNAL_PROJECT_INPUT = PROJECT_INPUT,
): ProjectCloudInitConfig {
	const yamlBody = renderProjectCloudInit(input).replace(
		/^#cloud-config\n/,
		'',
	)
	const parsed: unknown = parse(yamlBody)
	if (!isProjectCloudInitConfig(parsed)) {
		throw new Error('Parsed YAML is not a valid project cloud-init config')
	}
	return parsed
}

describe('renderProjectCloudInit', () => {
	it('starts with #cloud-config header', () => {
		expect(
			renderProjectCloudInit(PROJECT_INPUT).startsWith('#cloud-config\n'),
		).toBe(true)
	})

	it('does not include package_update or packages (pre-installed in golden image)', () => {
		const config = parseProjectCloudInit()
		expect(config.package_update).toBeUndefined()
		expect(config.packages).toBeUndefined()
	})

	it('writes the Tailscale auth key as the only write_files entry', () => {
		const writeFiles = parseProjectCloudInit().write_files
		if (!isProjectWriteFileArray(writeFiles)) {
			throw new Error('Expected write_files to be an array of files')
		}
		expect(writeFiles).toHaveLength(1)
		const first = writeFiles[0]!
		expect(first.path).toBe('/root/.tailscale-authkey')
		expect(first.content).toBe('tskey-auth-proj456')
		expect(first.permissions).toBe('0600')
	})

	it('injects the deploy SSH public key', () => {
		const config = parseProjectCloudInit()
		expect(config.users).toHaveLength(1)
		const deploy = config.users[0]!
		expect(deploy.name).toBe('deploy')
		expect(deploy.ssh_authorized_keys).toContain(
			'ssh-ed25519 AAAAC3Nz... deploy@ci',
		)
	})

	it('runs tailscale up reading the auth key from the write_files path', () => {
		const config = parseProjectCloudInit()
		expect(config.runcmd).toContain(
			'tailscale up --authkey="$(cat /root/.tailscale-authkey)" --hostname=my-project',
		)
	})

	it('shreds the Tailscale auth key file after joining', () => {
		const cmds = parseProjectCloudInit().runcmd
		expect(cmds).toContain('shred -u /root/.tailscale-authkey')
	})

	it('does not embed the raw auth key in any runcmd line', () => {
		for (const cmd of parseProjectCloudInit().runcmd) {
			expect(cmd).not.toContain('tskey-auth-proj456')
		}
	})

	it('does not install Docker, Caddy, or Vector (pre-installed)', () => {
		const joined = parseProjectCloudInit().runcmd.join('\n')
		expect(joined).not.toContain('get.docker.com')
		expect(joined).not.toContain('caddyserver.com')
		expect(joined).not.toContain('sh.vector.dev')
		expect(joined).not.toContain('tailscale.com/install.sh')
	})

	it('configures UFW rules for public mode', () => {
		const cmds = parseProjectCloudInit().runcmd
		expect(cmds).toContain('ufw allow 80/tcp')
		expect(cmds).toContain('ufw allow 443/tcp')
		expect(cmds).toContain(
			'ufw allow in on tailscale0 to any port 22 proto tcp',
		)
		expect(cmds).toContain('ufw --force enable')
	})

	it('configures internal-only UFW rules when internal', () => {
		const cmds = parseProjectCloudInit(INTERNAL_PROJECT_INPUT).runcmd
		expect(cmds).toContain(
			'ufw allow in on tailscale0 to any port 80 proto tcp',
		)
		expect(cmds).toContain(
			'ufw allow in on tailscale0 to any port 443 proto tcp',
		)
		expect(cmds).not.toContain('ufw allow 80/tcp')
		expect(cmds).not.toContain('ufw allow 443/tcp')
	})
})
