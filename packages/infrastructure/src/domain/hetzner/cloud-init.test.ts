import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import type { CloudInitConfig } from './cloud-init.ts'
import { isCloudInitConfig, renderCloudInit } from './cloud-init.ts'

const INPUT = {
	tailscaleAuthKey: 'tskey-auth-abc123',
	tailscaleHostname: 'acme-web',
	deployPublicKey: 'ssh-ed25519 AAAAC3Nz... deploy@ci',
} as const

function parseCloudInit(): CloudInitConfig {
	const yamlBody = renderCloudInit(INPUT).replace(/^#cloud-config\n/, '')
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

		it('writes the Vector systemd unit', () => {
			const file = findFile('/etc/systemd/system/vector.service')
			expect(file).toBeDefined()
			expect(file!.content).toContain(
				'ExecStart=/usr/bin/vector --config /etc/vector/vector.toml',
			)
			expect(file!.content).toContain(
				'EnvironmentFile=/etc/vector/vector.env',
			)
		})

		it('writes the Caddy systemd unit', () => {
			const file = findFile('/etc/systemd/system/caddy.service')
			expect(file).toBeDefined()
			expect(file!.content).toContain(
				'ExecStart=/usr/bin/caddy run --config /etc/caddy/config.json',
			)
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

		it('joins Tailscale with auth key and hostname', () => {
			expect(commands()).toContain(
				'tailscale up --authkey=tskey-auth-abc123 --hostname=acme-web',
			)
		})

		it('installs and joins Tailscale before Docker so SSH unlocks early', () => {
			const cmds = commands()
			const tailscaleUpIdx = cmds.indexOf(
				'tailscale up --authkey=tskey-auth-abc123 --hostname=acme-web',
			)
			const dockerIdx = cmds.indexOf(
				'curl -fsSL https://get.docker.com | sh',
			)
			expect(tailscaleUpIdx).toBeGreaterThanOrEqual(0)
			expect(dockerIdx).toBeGreaterThanOrEqual(0)
			expect(tailscaleUpIdx).toBeLessThan(dockerIdx)
		})

		it('installs Caddy with certmagic-s3 plugin', () => {
			const caddyCmd = commands().find(c => c.includes('certmagic-s3'))
			expect(caddyCmd).toBeDefined()
			expect(caddyCmd).toContain('/usr/bin/caddy')
		})

		it('enables Caddy and Vector systemd units', () => {
			const cmds = commands()
			expect(cmds).toContain('systemctl enable caddy')
			expect(cmds).toContain('systemctl enable vector')
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
	})
})
