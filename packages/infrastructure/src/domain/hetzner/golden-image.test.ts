import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	goldenImageFingerprint,
	renderGoldenImageCloudInit,
} from './golden-image.ts'

interface ParsedGoldenCloudInit {
	readonly package_update: boolean
	readonly packages: ReadonlyArray<string>
	readonly ssh_pwauth: boolean
	readonly disable_root: boolean
	readonly users: ReadonlyArray<{
		readonly name: string
		readonly lock_passwd: boolean
		readonly sudo: string
	}>
	readonly write_files: ReadonlyArray<{
		readonly path: string
		readonly content: string
		readonly permissions?: string
		readonly owner?: string
	}>
	readonly runcmd: ReadonlyArray<string>
	readonly power_state: {
		readonly mode: string
		readonly condition: boolean
	}
}

function isParsedGoldenCloudInit(
	value: unknown,
): value is ParsedGoldenCloudInit {
	if (typeof value !== 'object' || value === null) return false
	return (
		'packages' in value &&
		Array.isArray(value.packages) &&
		'write_files' in value &&
		Array.isArray(value.write_files) &&
		'runcmd' in value &&
		Array.isArray(value.runcmd) &&
		'power_state' in value &&
		typeof value.power_state === 'object' &&
		value.power_state !== null
	)
}

function parseGoldenImage(): ParsedGoldenCloudInit {
	const yamlBody = renderGoldenImageCloudInit().replace(
		/^#cloud-config\n/,
		'',
	)
	const parsed: unknown = parse(yamlBody)
	if (!isParsedGoldenCloudInit(parsed)) {
		expect.unreachable(
			'rendered golden image cloud-init did not parse into the expected shape',
		)
	}
	return parsed
}

describe('renderGoldenImageCloudInit', () => {
	it('starts with the #cloud-config header cloud-init requires', () => {
		expect(renderGoldenImageCloudInit().startsWith('#cloud-config\n')).toBe(
			true,
		)
	})

	it('installs the base system packages', () => {
		const config = parseGoldenImage()
		expect(config.packages).toContain('curl')
		expect(config.packages).toContain('ufw')
		expect(config.packages).toContain('ca-certificates')
	})

	it('creates the deploy user with no SSH key (per-project injects it)', () => {
		const [deploy] = parseGoldenImage().users
		expect(deploy).toBeDefined()
		expect(deploy!.name).toBe('deploy')
		expect(deploy!.lock_passwd).toBe(true)
		expect(deploy!.sudo).toBe('ALL=(ALL) NOPASSWD:ALL')
	})

	it('disables password auth and root login', () => {
		const config = parseGoldenImage()
		expect(config.ssh_pwauth).toBe(false)
		expect(config.disable_root).toBe(true)
	})

	it('writes the Docker daemon.json root-owned with enlarged address pools', () => {
		const file = parseGoldenImage().write_files.find(
			f => f.path === '/etc/docker/daemon.json',
		)
		expect(file).toBeDefined()
		expect(file!.owner).toBe('root:root')
		expect(file!.permissions).toBe('0644')
		expect(file!.content).toContain('172.17.0.0/12')
	})

	it.each([
		{
			path: '/etc/systemd/system/caddy.service',
			match: 'Requires=docker.service',
		},
		{
			path: '/etc/systemd/system/vector.service',
			match: '/etc/vector/vector.env',
		},
	])('writes the $path systemd unit', ({ path, match }) => {
		const file = parseGoldenImage().write_files.find(f => f.path === path)
		expect(file).toBeDefined()
		expect(file!.content).toContain(match)
	})

	it('installs Docker, Caddy, Vector and Tailscale via runcmd', () => {
		const joined = parseGoldenImage().runcmd.join('\n')
		expect(joined).toContain('https://get.docker.com')
		expect(joined).toContain('caddyserver.com/api/download')
		expect(joined).toContain('sh.vector.dev')
		expect(joined).toContain('tailscale.com/install.sh')
	})

	it('does NOT run `tailscale up` (auth key is per-project)', () => {
		const joined = parseGoldenImage().runcmd.join('\n')
		expect(joined).not.toContain('tailscale up')
	})

	it('does NOT configure UFW rules (per-project concern)', () => {
		const joined = parseGoldenImage().runcmd.join('\n')
		expect(joined).not.toContain('ufw allow')
		expect(joined).not.toContain('ufw --force enable')
	})

	it('enables caddy and vector systemd units', () => {
		const cmds = parseGoldenImage().runcmd
		expect(cmds).toContain('systemctl enable caddy vector')
	})

	it('shuts the VPS down at the end so the orchestrator can snapshot status=off', () => {
		expect(parseGoldenImage().power_state.mode).toBe('poweroff')
	})
})

describe('goldenImageFingerprint', () => {
	it('returns a 16-char hex string', () => {
		expect(goldenImageFingerprint()).toMatch(/^[0-9a-f]{16}$/)
	})

	it('is deterministic across calls', () => {
		expect(goldenImageFingerprint()).toBe(goldenImageFingerprint())
	})
})
