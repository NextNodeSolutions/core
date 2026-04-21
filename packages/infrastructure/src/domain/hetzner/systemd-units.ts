/**
 * Single source of truth for the systemd unit files that manage Caddy and
 * Vector on NextNode VPS hosts.
 *
 * Both boot paths must write byte-identical unit files:
 *   - Fresh VPS → cloud-init `write_files` (see `cloud-init.ts`)
 *   - Golden-image VPS → `packer/scripts/setup.sh`
 *
 * Divergence caused a production outage (Caddy unit on the golden image
 * omitted `EnvironmentFile=-/etc/caddy/env`, which made the `{env.X}`
 * placeholders in `/etc/caddy/config.json` resolve to empty strings, crashed
 * Caddy, and produced `caddy reload → connection refused` at deploy time).
 * Both paths now import the constants below; `packer/scripts/setup.test.ts`
 * asserts the shell script embeds them verbatim.
 */

export interface SystemdUnit {
	readonly path: string
	readonly content: string
}

// Caddy MUST start after dockerd: once upstreams become container IPs,
// reloading Caddy before Docker is ready would leave routes pointing at
// nothing. `Requires=docker.service` also propagates dockerd failures so
// Caddy doesn't sit serving 502s on top of a broken container plane.
export const CADDY_UNIT: SystemdUnit = {
	path: '/etc/systemd/system/caddy.service',
	content: `[Unit]
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
`,
}

export const VECTOR_UNIT: SystemdUnit = {
	path: '/etc/systemd/system/vector.service',
	content: `[Unit]
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
`,
}
