import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type { CloudInitConfig } from './cloud-init.ts'
import {
	isCloudInitConfig,
	renderCloudInit,
	renderProjectCloudInit,
} from './cloud-init.ts'
import { DOCKER_DAEMON_CONFIG } from './docker-daemon-config.ts'
import { CADDY_UNIT, VECTOR_UNIT } from './systemd-units.ts'

const INPUT = {
	tailscaleAuthKey: 'tskey-auth-abc123',
	tailscaleHostname: 'acme-web',
	deployPublicKey: 'ssh-ed25519 AAAAC3Nz... deploy@ci',
	internal: false,
} as const

const INTERNAL_INPUT = { ...INPUT, internal: true } as const

function parseCloudInit(
	input: typeof INPUT | typeof INTERNAL_INPUT = INPUT,
): CloudInitConfig {
	const yamlBody = renderCloudInit(input).replace(/^#cloud-config\n/, '')
	const parsed: unknown = parse(yamlBody)
	if (!isCloudInitConfig(parsed)) {
		throw new Error('Parsed YAML is not a valid cloud-init config')
	}
	return parsed
}

describe('renderCloudInit', () => {
	it('starts with #cloud-config header', () => {
		expect(renderCloudInit(INPUT).startsWith('#cloud-config\n')).toBe(true)
	})

	it('produces valid YAML after the header', () => {
		const config = parseCloudInit()
		expect(config.package_update).toBe(true)
		expect(config.packages.length).toBeGreaterThan(0)
		expect(config.write_files.length).toBeGreaterThan(0)
		expect(config.runcmd.length).toBeGreaterThan(0)
	})

	it('installs required system packages', () => {
		const config = parseCloudInit()
		expect(config.packages).toContain('curl')
		expect(config.packages).toContain('ufw')
		expect(config.packages).toContain('ca-certificates')
	})

	describe('SSH hardening', () => {
		it('disables SSH password authentication', () => {
			expect(parseCloudInit().ssh_pwauth).toBe(false)
		})

		it('disables root SSH login', () => {
			expect(parseCloudInit().disable_root).toBe(true)
		})
	})

	describe('users', () => {
		it('creates a single deploy user', () => {
			const config = parseCloudInit()
			expect(config.users).toHaveLength(1)
			expect(config.users[0]!.name).toBe('deploy')
		})

		it('installs the deploy SSH public key on the deploy user', () => {
			const deploy = parseCloudInit().users[0]!
			expect(deploy.ssh_authorized_keys).toContain(
				'ssh-ed25519 AAAAC3Nz... deploy@ci',
			)
		})

		it('grants deploy passwordless sudo', () => {
			const deploy = parseCloudInit().users[0]!
			expect(deploy.sudo).toBe('ALL=(ALL) NOPASSWD:ALL')
		})

		it('locks the deploy user password (no password login possible)', () => {
			const deploy = parseCloudInit().users[0]!
			expect(deploy.lock_passwd).toBe(true)
		})
	})

	describe('write_files', () => {
		function findFile(
			path: string,
		): CloudInitConfig['write_files'][number] | undefined {
			return parseCloudInit().write_files.find(f => f.path === path)
		}

		it.each([
			{ name: 'Vector', unit: VECTOR_UNIT },
			{ name: 'Caddy', unit: CADDY_UNIT },
		])('writes the $name systemd unit byte-identically', ({ unit }) => {
			const file = findFile(unit.path)
			expect(file).toBeDefined()
			expect(file!.content).toBe(unit.content)
		})

		it('writes Docker daemon.json byte-identically, root-owned', () => {
			const file = findFile(DOCKER_DAEMON_CONFIG.path)
			expect(file).toBeDefined()
			expect(file!.content).toBe(DOCKER_DAEMON_CONFIG.content)
			expect(file!.permissions).toBe('0644')
			expect(file!.owner).toBe('root:root')
		})

		it('does not write any root SSH keys (root login disabled)', () => {
			const rootKey = findFile('/root/.ssh/authorized_keys')
			expect(rootKey).toBeUndefined()
		})

		it('writes an empty Caddy config.json', () => {
			const file = findFile('/etc/caddy/config.json')
			expect(file).toBeDefined()
			expect(file!.content).toContain('{}')
		})

		it('writes the Tailscale auth key to a root-only 0600 file', () => {
			const file = findFile('/root/.tailscale-authkey')
			expect(file).toBeDefined()
			expect(file!.content).toBe('tskey-auth-abc123')
			expect(file!.permissions).toBe('0600')
			expect(file!.owner).toBe('root:root')
		})
	})

	describe('runcmd', () => {
		function commands(): ReadonlyArray<string> {
			return parseCloudInit().runcmd
		}

		it('installs Docker CE', () => {
			expect(commands()).toContain(
				'curl -fsSL https://get.docker.com | sh',
			)
		})

		it('joins Tailscale reading the auth key from the write_files path', () => {
			expect(commands()).toContain(
				'tailscale up --authkey="$(cat /root/.tailscale-authkey)" --hostname=acme-web',
			)
		})

		it('shreds the Tailscale auth key file right after tailscale up', () => {
			const cmds = commands()
			const upIdx = cmds.indexOf(
				'tailscale up --authkey="$(cat /root/.tailscale-authkey)" --hostname=acme-web',
			)
			const shredIdx = cmds.indexOf('shred -u /root/.tailscale-authkey')
			expect(upIdx).toBeGreaterThanOrEqual(0)
			expect(shredIdx).toBe(upIdx + 1)
		})

		it('does not embed the raw auth key value in any runcmd line', () => {
			for (const cmd of commands()) {
				expect(cmd).not.toContain('tskey-auth-abc123')
			}
		})

		it('installs and joins Tailscale before Docker so SSH unlocks early', () => {
			const cmds = commands()
			const tailscaleUpIdx = cmds.indexOf(
				'tailscale up --authkey="$(cat /root/.tailscale-authkey)" --hostname=acme-web',
			)
			const dockerIdx = cmds.indexOf(
				'curl -fsSL https://get.docker.com | sh',
			)
			expect(tailscaleUpIdx).toBeGreaterThanOrEqual(0)
			expect(dockerIdx).toBeGreaterThanOrEqual(0)
			expect(tailscaleUpIdx).toBeLessThan(dockerIdx)
		})

		it('installs Caddy with certmagic-s3 and cloudflare DNS plugins', () => {
			const caddyCmd = commands().find(c => c.includes('certmagic-s3'))
			expect(caddyCmd).toBeDefined()
			expect(caddyCmd).toContain('/usr/bin/caddy')
			expect(caddyCmd).toContain('caddy-dns/cloudflare')
		})

		it.each(['caddy', 'vector'])('enables the %s systemd unit', unit => {
			expect(commands()).toContain(`systemctl enable ${unit}`)
		})

		it('adds deploy to docker group after Docker install', () => {
			const cmds = commands()
			const dockerIdx = cmds.indexOf(
				'curl -fsSL https://get.docker.com | sh',
			)
			const usermodIdx = cmds.indexOf('usermod -aG docker deploy')
			expect(dockerIdx).toBeGreaterThanOrEqual(0)
			expect(usermodIdx).toBeGreaterThan(dockerIdx)
		})

		it('does not create deploy via useradd (handled by users: declarative section)', () => {
			expect(commands()).not.toContain('useradd -m -s /bin/bash deploy')
		})

		it('transfers /etc/caddy and /etc/vector ownership to deploy', () => {
			expect(commands()).toContain(
				'chown -R deploy:deploy /etc/caddy /etc/vector',
			)
		})

		it('creates /opt/apps owned by deploy', () => {
			const cmds = commands()
			expect(cmds).toContain('mkdir -p /opt/apps')
			expect(cmds).toContain('chown deploy:deploy /opt/apps')
		})

		it('configures UFW with 80, 443, and SSH on tailscale0 only', () => {
			const cmds = commands()
			expect(cmds).toContain('ufw allow 80/tcp')
			expect(cmds).toContain('ufw allow 443/tcp')
			expect(cmds).toContain(
				'ufw allow in on tailscale0 to any port 22 proto tcp',
			)
			expect(cmds).toContain('ufw --force enable')
		})

		it('does not open port 22 globally', () => {
			expect(commands()).not.toContain('ufw allow 22/tcp')
		})

		describe('internal mode UFW', () => {
			function internalCommands(): ReadonlyArray<string> {
				return parseCloudInit(INTERNAL_INPUT).runcmd
			}

			it('restricts HTTP to tailscale0 only', () => {
				const cmds = internalCommands()
				expect(cmds).toContain(
					'ufw allow in on tailscale0 to any port 80 proto tcp',
				)
				expect(cmds).not.toContain('ufw allow 80/tcp')
			})

			it('restricts HTTPS to tailscale0 only', () => {
				const cmds = internalCommands()
				expect(cmds).toContain(
					'ufw allow in on tailscale0 to any port 443 proto tcp',
				)
				expect(cmds).not.toContain('ufw allow 443/tcp')
			})

			it('restricts SSH to tailscale0 only', () => {
				expect(internalCommands()).toContain(
					'ufw allow in on tailscale0 to any port 22 proto tcp',
				)
			})
		})
	})
})

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
