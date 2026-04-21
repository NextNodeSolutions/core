import { DOCKER_DAEMON_CONFIG } from './docker-daemon-config.ts'
import type { SystemdUnit } from './systemd-units.ts'
import { CADDY_UNIT, VECTOR_UNIT } from './systemd-units.ts'

interface HeredocFile {
	readonly path: string
	readonly content: string
}

function renderHeredoc(file: HeredocFile, marker: string): string {
	return `cat > ${file.path} << '${marker}'\n${file.content}${marker}\n`
}

function renderUnit(unit: SystemdUnit): string {
	return renderHeredoc(unit, 'UNIT')
}

const CADDY_PLUGINS_URL =
	'https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/ss098/certmagic-s3&p=github.com/caddy-dns/cloudflare'

export function buildSetupScript(): string {
	return `#!/usr/bin/env bash
set -euo pipefail

# NextNode base image provisioner
# Installs all shared software so per-project provisioning only needs
# Tailscale auth, SSH key injection, and UFW rules.

export DEBIAN_FRONTEND=noninteractive

# ── System packages ──────────────────────────────────────────────────
apt-get update
apt-get install -y apt-transport-https ca-certificates curl gnupg ufw

# ── Tailscale (install only - \`tailscale up\` is per-project) ─────────
curl -fsSL https://tailscale.com/install.sh | sh

# ── Docker daemon config (written BEFORE Docker installs so dockerd
#    picks up the enlarged default-address-pools on first start) ──────
mkdir -p /etc/docker
${renderHeredoc(DOCKER_DAEMON_CONFIG, 'DAEMON')}
# ── Docker CE ────────────────────────────────────────────────────────
curl -fsSL https://get.docker.com | sh

# ── Caddy with S3 storage + Cloudflare DNS plugins ──────────────────
CADDY_URL="${CADDY_PLUGINS_URL}"
curl -fsSL "\${CADDY_URL}" -o /usr/bin/caddy
chmod +x /usr/bin/caddy
mkdir -p /etc/caddy
echo '{}' > /etc/caddy/config.json

# ── Vector log agent ─────────────────────────────────────────────────
curl -fsSL https://sh.vector.dev | bash -s -- -y --prefix /usr
mkdir -p /etc/vector

# ── Systemd units ────────────────────────────────────────────────────
${renderUnit(CADDY_UNIT)}
${renderUnit(VECTOR_UNIT)}
systemctl daemon-reload
systemctl enable caddy vector

# ── Deploy user (no SSH key - injected per-project via cloud-init) ───
useradd -m -s /bin/bash deploy
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy
chmod 0440 /etc/sudoers.d/deploy
usermod -aG docker deploy

# ── Directory ownership ──────────────────────────────────────────────
chown -R deploy:deploy /etc/caddy /etc/vector
mkdir -p /opt/apps
chown deploy:deploy /opt/apps
`
}
