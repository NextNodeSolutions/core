import { stringify } from 'yaml'

export interface CloudInitInput {
	readonly tailscaleAuthKey: string
	readonly tailscaleHostname: string
	readonly deployPublicKey: string
}

export interface CloudInitConfig {
	readonly package_update: boolean
	readonly packages: ReadonlyArray<string>
	readonly write_files: ReadonlyArray<{
		readonly path: string
		readonly content: string
	}>
	readonly runcmd: ReadonlyArray<string>
}

export function isCloudInitConfig(value: unknown): value is CloudInitConfig {
	if (typeof value !== 'object' || value === null) return false
	return (
		'packages' in value &&
		Array.isArray(value.packages) &&
		'write_files' in value &&
		Array.isArray(value.write_files) &&
		'runcmd' in value &&
		Array.isArray(value.runcmd)
	)
}

const PACKAGES = [
	'apt-transport-https',
	'ca-certificates',
	'curl',
	'gnupg',
	'ufw',
]

const VECTOR_UNIT = `[Unit]
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

const CADDY_UNIT = `[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/caddy run --config /etc/caddy/config.json
ExecReload=/usr/bin/caddy reload --config /etc/caddy/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`

function buildWriteFiles(
	deployPublicKey: string,
): ReadonlyArray<{ readonly path: string; readonly content: string }> {
	return [
		{ path: '/etc/systemd/system/vector.service', content: VECTOR_UNIT },
		{ path: '/etc/systemd/system/caddy.service', content: CADDY_UNIT },
		{
			path: '/home/deploy/.ssh/authorized_keys',
			content: `${deployPublicKey}\n`,
		},
		{ path: '/etc/caddy/config.json', content: '{}\n' },
	]
}

function buildRuncmd(
	tailscaleAuthKey: string,
	tailscaleHostname: string,
): ReadonlyArray<string> {
	return [
		// Docker CE
		'curl -fsSL https://get.docker.com | sh',

		// Tailscale
		'curl -fsSL https://tailscale.com/install.sh | sh',
		`tailscale up --authkey=${tailscaleAuthKey} --hostname=${tailscaleHostname}`,

		// Caddy with S3 storage plugin
		'curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/ss098/certmagic-s3" -o /usr/bin/caddy',
		'chmod +x /usr/bin/caddy',
		'mkdir -p /etc/caddy',
		'systemctl daemon-reload',
		'systemctl enable caddy',

		// Vector
		'curl -fsSL https://sh.vector.dev | bash -s -- -y --prefix /usr',
		'mkdir -p /etc/vector',
		'systemctl daemon-reload',
		'systemctl enable vector',

		// Deploy user
		'useradd -m -s /bin/bash deploy',
		'mkdir -p /home/deploy/.ssh',
		'chown -R deploy:deploy /home/deploy/.ssh',
		'chmod 700 /home/deploy/.ssh',
		'chmod 600 /home/deploy/.ssh/authorized_keys',
		'usermod -aG docker deploy',

		// App directory
		'mkdir -p /opt/apps',
		'chown deploy:deploy /opt/apps',

		// UFW firewall
		'ufw default deny incoming',
		'ufw default allow outgoing',
		'ufw allow 80/tcp',
		'ufw allow 443/tcp',
		'ufw allow in on tailscale0 to any port 22 proto tcp',
		'ufw --force enable',
	]
}

export function renderCloudInit(input: CloudInitInput): string {
	const config = {
		package_update: true,
		packages: PACKAGES,
		write_files: buildWriteFiles(input.deployPublicKey),
		runcmd: buildRuncmd(input.tailscaleAuthKey, input.tailscaleHostname),
	} satisfies CloudInitConfig

	return `#cloud-config\n${stringify(config, { lineWidth: 0, blockQuote: 'literal' })}`
}
