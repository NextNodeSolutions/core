import { stringify } from 'yaml'

export interface CloudInitInput {
	readonly tailscaleAuthKey: string
	readonly tailscaleHostname: string
	readonly deployPublicKey: string
}

export interface CloudInitUser {
	readonly name: string
	readonly shell: string
	readonly sudo: string
	readonly lock_passwd: boolean
	readonly ssh_authorized_keys: ReadonlyArray<string>
}

export interface CloudInitConfig {
	readonly package_update: boolean
	readonly packages: ReadonlyArray<string>
	readonly ssh_pwauth: boolean
	readonly disable_root: boolean
	readonly users: ReadonlyArray<CloudInitUser>
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
		'ssh_pwauth' in value &&
		typeof value.ssh_pwauth === 'boolean' &&
		'disable_root' in value &&
		typeof value.disable_root === 'boolean' &&
		'users' in value &&
		Array.isArray(value.users) &&
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

function buildUsers(deployPublicKey: string): ReadonlyArray<CloudInitUser> {
	// Declarative user creation runs BEFORE runcmd, so the SSH key is
	// installed early. lock_passwd removes any password hash entirely — no
	// password login, no expiration edge cases. NOPASSWD:ALL is equivalent
	// in privilege to docker-group membership (which deploy also has), so
	// we don't lose isolation by granting it.
	return [
		{
			name: 'deploy',
			shell: '/bin/bash',
			sudo: 'ALL=(ALL) NOPASSWD:ALL',
			lock_passwd: true,
			ssh_authorized_keys: [deployPublicKey],
		},
	]
}

function buildWriteFiles(): ReadonlyArray<{
	readonly path: string
	readonly content: string
}> {
	return [
		{ path: '/etc/systemd/system/vector.service', content: VECTOR_UNIT },
		{ path: '/etc/systemd/system/caddy.service', content: CADDY_UNIT },
		{ path: '/etc/caddy/config.json', content: '{}\n' },
	]
}

function buildRuncmd(
	tailscaleAuthKey: string,
	tailscaleHostname: string,
): ReadonlyArray<string> {
	return [
		// Tailscale FIRST: unlocks SSH via tailnet in ~10s so the runner can
		// poll the Tailscale API and proceed while the rest of runcmd (Docker,
		// Caddy, Vector) keeps installing. convergeVps gates on `cloud-init
		// status --wait` before touching those.
		'curl -fsSL https://tailscale.com/install.sh | sh',
		`tailscale up --authkey=${tailscaleAuthKey} --hostname=${tailscaleHostname}`,

		// Docker CE
		'curl -fsSL https://get.docker.com | sh',

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

		// deploy user was created declaratively via `users:`. Docker group
		// exists only after Docker install above, so we wire it here.
		'usermod -aG docker deploy',

		// Give deploy write access to service config dirs so convergence
		// can push Caddy/Vector configs via SFTP without sudo. Services
		// still run as root; they only need read access to these files.
		'chown -R deploy:deploy /etc/caddy /etc/vector',

		// App directory
		'mkdir -p /opt/apps',
		'chown deploy:deploy /opt/apps',

		// UFW firewall — SSH is tailnet-only; 80/443 public for Caddy.
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
		// Hard-disable SSH password auth and root login. Combined with
		// UFW restricting port 22 to tailscale0, the server has no
		// public SSH surface at all.
		ssh_pwauth: false,
		disable_root: true,
		users: buildUsers(input.deployPublicKey),
		write_files: buildWriteFiles(),
		runcmd: buildRuncmd(input.tailscaleAuthKey, input.tailscaleHostname),
	} satisfies CloudInitConfig

	return `#cloud-config\n${stringify(config, { lineWidth: 0, blockQuote: 'literal' })}`
}
