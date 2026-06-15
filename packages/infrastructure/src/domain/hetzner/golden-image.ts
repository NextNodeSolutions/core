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

/**
 * node_exporter: pinned static binary, host-level machine metrics
 * (CPU/memory/disk/network/pressure). Listens on :9100 on every
 * interface, but reachability is enforced by the layered firewalls: the
 * Hetzner Cloud firewall only opens 80/443/22 and UFW only allows the
 * port in on tailscale0 (see buildUfwRules) - so the sole consumer is
 * the vmagent scrape job running on another tailnet node.
 */
export const NODE_EXPORTER_VERSION = '1.9.1'
const NODE_EXPORTER_TARBALL = `node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64`
const NODE_EXPORTER_DOWNLOAD_URL = `https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/${NODE_EXPORTER_TARBALL}.tar.gz`

// Pinned Vector release. The old install piped `https://sh.vector.dev` into
// bash: unpinned (silent version drift) AND failure-masking (a curl/network
// error in the pipe still exited 0, so the snapshot could ship WITHOUT the
// binary while the build reported success - exactly what stranded vector.service
// with "No such file or directory"). Mirror the node_exporter pattern: a pinned
// GitHub-release tarball, fail-loud (`curl -f` + `install` propagate errors).
// The tarball's top dir is NOT version-prefixed (vector-<arch>/bin/vector).
export const VECTOR_VERSION = '0.56.0'
const VECTOR_DIR = 'vector-x86_64-unknown-linux-gnu'
const VECTOR_DOWNLOAD_URL = `https://github.com/vectordotdev/vector/releases/download/v${VECTOR_VERSION}/vector-${VECTOR_VERSION}-x86_64-unknown-linux-gnu.tar.gz`

/**
 * Shell commands that install the pinned Vector binary to /usr/bin/vector.
 * Shared by the golden-image build (baked in) and the convergence self-heal
 * (installs on demand for VPS whose snapshot predates / lost the binary).
 *
 * Only the `install` into /usr/bin is privileged: the golden-image runcmd runs
 * as root (`privilege = ''`), the convergence runs as the `deploy` user over SSH
 * (`privilege = 'sudo'`). The download + cleanup touch /tmp only.
 */
export function vectorInstallCommands(
	privilege: '' | 'sudo' = '',
): ReadonlyArray<string> {
	const sudo = privilege === '' ? '' : `${privilege} `
	return [
		`curl -fsSL "${VECTOR_DOWNLOAD_URL}" | tar -xz -C /tmp`,
		`${sudo}install -m 0755 /tmp/${VECTOR_DIR}/bin/vector /usr/bin/vector`,
		`rm -rf /tmp/${VECTOR_DIR}`,
	]
}

const NODE_EXPORTER_UNIT_PATH = '/etc/systemd/system/node_exporter.service'
const NODE_EXPORTER_UNIT_CONTENT = `[Unit]
Description=Prometheus node_exporter
After=network-online.target
Wants=network-online.target

[Service]
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/node_exporter --web.listen-address=:9100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`

/**
 * cAdvisor: per-container metrics (CPU/memory/restarts/OOM/last_seen),
 * pinned image, run by systemd as a docker container. Published on
 * \${TS_IP}:9101 - the tailnet IP does not exist at image-build time, so
 * the unit is installed DISABLED and reads /etc/monitoring/env, which
 * the convergence step writes before \`systemctl enable --now cadvisor\`
 * (the exact pattern vector.env uses). Port 9101 dodges the app host
 * port range [8080, 8200). The flag set caps cardinality at the source:
 * docker-only, no container labels, the verbose collectors disabled.
 */
export const CADVISOR_IMAGE = 'gcr.io/cadvisor/cadvisor:v0.49.1'
export const MONITORING_ENV_PATH = '/etc/monitoring/env'

const CADVISOR_DISABLED_METRICS =
	'advtcp,cpu_topology,cpuset,hugetlb,memory_numa,percpu,process,referenced_memory,resctrl,sched,tcp,udp'

const CADVISOR_RUN_ARGS = [
	'--rm',
	'--name=cadvisor',
	'--volume=/:/rootfs:ro',
	'--volume=/var/run:/var/run:ro',
	'--volume=/sys:/sys:ro',
	'--volume=/var/lib/docker/:/var/lib/docker:ro',
	'--volume=/dev/disk/:/dev/disk:ro',
	'--device=/dev/kmsg',
	// eslint-disable-next-line no-template-curly-in-string -- systemd expands ${TS_IP} from EnvironmentFile at start time
	'--publish=${TS_IP}:9101:8080',
].join(' \\\n  ')

const CADVISOR_FLAGS = [
	'--docker_only=true',
	'--store_container_labels=false',
	`--disable_metrics=${CADVISOR_DISABLED_METRICS}`,
].join(' ')

const CADVISOR_UNIT_PATH = '/etc/systemd/system/cadvisor.service'
const CADVISOR_UNIT_CONTENT = `[Unit]
Description=cAdvisor container metrics
After=docker.service tailscaled.service
Requires=docker.service

[Service]
EnvironmentFile=${MONITORING_ENV_PATH}
ExecStartPre=-/usr/bin/docker rm -f cadvisor
ExecStart=/usr/bin/docker run ${CADVISOR_RUN_ARGS} \\
  ${CADVISOR_IMAGE} ${CADVISOR_FLAGS}
ExecStop=/usr/bin/docker stop cadvisor
Restart=always
RestartSec=10

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
	{ path: NODE_EXPORTER_UNIT_PATH, content: NODE_EXPORTER_UNIT_CONTENT },
	{ path: CADVISOR_UNIT_PATH, content: CADVISOR_UNIT_CONTENT },
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
	// Tailscale (install only - `tailscale up` runs per-project from renderProjectCloudInit)
	'curl -fsSL https://tailscale.com/install.sh | sh',

	// Docker CE (daemon.json was written BEFORE this so the first start picks it up)
	'curl -fsSL https://get.docker.com | sh',

	// Pre-pull the cAdvisor image so first boot does not depend on gcr.io
	`docker pull ${CADVISOR_IMAGE}`,

	// Caddy with S3 storage + Cloudflare DNS plugins
	`curl -fsSL "${CADDY_DOWNLOAD_URL}" -o /usr/bin/caddy`,
	'chmod +x /usr/bin/caddy',
	'mkdir -p /etc/caddy',

	// Vector (pinned tarball, fail-loud - see vectorInstallCommands). runcmd
	// runs as root, so no sudo prefix.
	...vectorInstallCommands(),
	'mkdir -p /etc/vector',

	// node_exporter (pinned static binary, unit written above)
	`curl -fsSL "${NODE_EXPORTER_DOWNLOAD_URL}" | tar -xz -C /tmp`,
	`install -m 0755 /tmp/${NODE_EXPORTER_TARBALL}/node_exporter /usr/local/bin/node_exporter`,
	`rm -rf /tmp/${NODE_EXPORTER_TARBALL}`,

	// cAdvisor env dir - the convergence step writes TS_IP here, then
	// enables the (deliberately disabled) cadvisor unit.
	'mkdir -p /etc/monitoring',

	'systemctl daemon-reload',
	// cadvisor is NOT enabled here: its EnvironmentFile does not exist
	// until the VPS has joined the tailnet (convergence writes it).
	'systemctl enable caddy vector node_exporter',

	// deploy needs docker group access; the group exists only after Docker install.
	'usermod -aG docker deploy',

	// Let deploy push Caddy/Vector/monitoring configs via SFTP without
	// sudo. Services still run as root - they only need read access.
	'chown -R deploy:deploy /etc/caddy /etc/vector /etc/monitoring',

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
