#!/usr/bin/env bash
set -euo pipefail

# NextNode base image provisioner
# Installs all shared software so per-project provisioning only needs
# Tailscale auth, SSH key injection, and UFW rules.

export DEBIAN_FRONTEND=noninteractive

# ── System packages ──────────────────────────────────────────────────
apt-get update
apt-get install -y apt-transport-https ca-certificates curl gnupg ufw

# ── Tailscale (install only - `tailscale up` is per-project) ─────────
curl -fsSL https://tailscale.com/install.sh | sh

# ── Docker CE ────────────────────────────────────────────────────────
curl -fsSL https://get.docker.com | sh

# ── Caddy with S3 storage + Cloudflare DNS plugins ──────────────────
CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=amd64&p=github.com/ss098/certmagic-s3&p=github.com/caddy-dns/cloudflare"
curl -fsSL "${CADDY_URL}" -o /usr/bin/caddy
chmod +x /usr/bin/caddy
mkdir -p /etc/caddy
echo '{}' > /etc/caddy/config.json

# ── Vector log agent ─────────────────────────────────────────────────
curl -fsSL https://sh.vector.dev | bash -s -- -y --prefix /usr
mkdir -p /etc/vector

# ── Systemd units ────────────────────────────────────────────────────
cat > /etc/systemd/system/caddy.service << 'UNIT'
[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=-/etc/caddy/env
ExecStart=/usr/bin/caddy run --config /etc/caddy/config.json
ExecReload=/usr/bin/caddy reload --config /etc/caddy/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/vector.service << 'UNIT'
[Unit]
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
UNIT

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
