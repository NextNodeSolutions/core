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

		it('writes the deploy SSH authorized_keys', () => {
			const file = findFile('/home/deploy/.ssh/authorized_keys')
			expect(file).toBeDefined()
			expect(file!.content).toContain('ssh-ed25519 AAAAC3Nz... deploy@ci')
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

		it('creates deploy user with docker group', () => {
			const cmds = commands()
			expect(cmds).toContain('useradd -m -s /bin/bash deploy')
			expect(cmds).toContain('usermod -aG docker deploy')
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
