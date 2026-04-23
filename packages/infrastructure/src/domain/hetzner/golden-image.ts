import { createHash } from 'node:crypto'

import { stringify } from 'yaml'

const FINGERPRINT_LENGTH = 16

const DAEMON_JSON_PATH = '/etc/docker/daemon.json'
const DAEMON_JSON_CONTENT = `{
  "default-address-pools": [
    { "base": "172.17.0.0/12", "size": 24 }
  ]
}
`

const CADDY_UNIT_PATH = '/etc/systemd/system/caddy.service'
const CADDY_UNIT_CONTENT = `[Unit]
Description=Caddy web server
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
EnvironmentFile=-/etc/caddy/env
ExecStart=/usr/bin/caddy run --config /etc/caddy/config.json
ExecReload=/usr/bin/caddy reload --config /etc/caddy/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`

const VECTOR_UNIT_PATH = '/etc/systemd/system/vector.service'
const VECTOR_UNIT_CONTENT = `[Unit]
Description=Vector log agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/vector --config /etc/vector/vector.toml
EnvironmentFile=/etc/vector/vector.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`

const CADDY_DOWNLOAD_URL =
	'https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/ss098/certmagic-s3&p=github.com/caddy-dns/cloudflare'

const PACKAGES = [
	'apt-transport-https',
	'ca-certificates',
	'curl',
	'gnupg',
	'ufw',
]

const WRITE_FILES = [
	{
		path: DAEMON_JSON_PATH,
		content: DAEMON_JSON_CONTENT,
		permissions: '0644',
		owner: 'root:root',
	},
	{ path: CADDY_UNIT_PATH, content: CADDY_UNIT_CONTENT },
	{ path: VECTOR_UNIT_PATH, content: VECTOR_UNIT_CONTENT },
	{ path: '/etc/caddy/config.json', content: '{}\n' },
]

const USERS = [
	{
		name: 'deploy',
		shell: '/bin/bash',
		sudo: 'ALL=(ALL) NOPASSWD:ALL',
		lock_passwd: true,
	},
]

const RUNCMD: ReadonlyArray<string> = [
	// Tailscale (install only — `tailscale up` runs per-project from renderProjectCloudInit)
	'curl -fsSL https://tailscale.com/install.sh | sh',

	// Docker CE (daemon.json was written BEFORE this so the first start picks it up)
	'curl -fsSL https://get.docker.com | sh',

	// Caddy with S3 storage + Cloudflare DNS plugins
	`curl -fsSL "${CADDY_DOWNLOAD_URL}" -o /usr/bin/caddy`,
	'chmod +x /usr/bin/caddy',
	'mkdir -p /etc/caddy',

	// Vector
	'curl -fsSL https://sh.vector.dev | bash -s -- -y --prefix /usr',
	'mkdir -p /etc/vector',

	'systemctl daemon-reload',
	'systemctl enable caddy vector',

	// deploy needs docker group access; the group exists only after Docker install.
	'usermod -aG docker deploy',

	// Let deploy push Caddy/Vector configs via SFTP without sudo. Services
	// still run as root - they only need read access to these files.
	'chown -R deploy:deploy /etc/caddy /etc/vector',

	'mkdir -p /opt/apps',
	'chown deploy:deploy /opt/apps',
]

/**
 * cloud-init for the short-lived builder VPS. Ends with `poweroff` so the
 * orchestrator can observe `status=off` and snapshot a clean disk. Per-project
 * concerns (SSH key, Tailscale auth, UFW) live in `renderProjectCloudInit`.
 */
export function renderGoldenImageCloudInit(): string {
	const config = {
		package_update: true,
		packages: PACKAGES,
		ssh_pwauth: false,
		disable_root: true,
		users: USERS,
		write_files: WRITE_FILES,
		runcmd: RUNCMD,
		power_state: {
			mode: 'poweroff',
			message: 'golden image build complete',
			timeout: 30,
			condition: true,
		},
	}

	return `#cloud-config\n${stringify(config, { lineWidth: 0, blockQuote: 'literal' })}`
}

/**
 * Deterministic fingerprint of the golden image cloud-init. Stamped on the
 * snapshot's `infra_fingerprint` label so drift against the current source
 * triggers a rebuild.
 */
export function goldenImageFingerprint(): string {
	return createHash('sha256')
		.update(renderGoldenImageCloudInit())
		.digest('hex')
		.slice(0, FINGERPRINT_LENGTH)
}
