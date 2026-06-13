import { stringify } from 'yaml'

export interface ProjectCloudInitInput {
	readonly tailscaleAuthKey: string
	readonly tailscaleHostname: string
	readonly deployPublicKey: string
	readonly isInternal: boolean
	/**
	 * Tailscale tags the node advertises at `tailscale up`. Must match
	 * the tags the authkey was minted with (computeTailscaleTags) - a
	 * mismatch is rejected by the Tailscale control plane.
	 */
	readonly tailscaleTags: ReadonlyArray<string>
}

export interface CloudInitUser {
	readonly name: string
	readonly shell: string
	readonly sudo: string
	readonly lock_passwd: boolean
	readonly ssh_authorized_keys: ReadonlyArray<string>
}

export interface CloudInitWriteFile {
	readonly path: string
	readonly content: string
	readonly permissions?: string
	readonly owner?: string
}

const TAILSCALE_AUTHKEY_PATH = '/root/.tailscale-authkey'

function buildUsers(deployPublicKey: string): ReadonlyArray<CloudInitUser> {
	// Declarative user creation runs BEFORE runcmd, so the SSH key is
	// installed early. lock_passwd removes any password hash entirely - no
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

function buildTailscaleAuthKeyFile(authKey: string): CloudInitWriteFile {
	// Owner/perms lock the key to root so only the runcmd (which runs as root)
	// can read it. The file is shredded in runcmd right after `tailscale up`,
	// closing the exposure window to a few seconds.
	return {
		path: TAILSCALE_AUTHKEY_PATH,
		content: authKey,
		permissions: '0600',
		owner: 'root:root',
	}
}

// node_exporter listens on :9100 on every interface; this UFW rule is
// what restricts it to the tailnet (the Hetzner Cloud firewall already
// blocks it from the public internet - layered defence). cAdvisor (9101)
// and postgres-exporter (9187) need no rule: their docker port
// publications bind ${TS_IP} and traverse iptables, not UFW INPUT.
const NODE_EXPORTER_UFW_RULE =
	'ufw allow in on tailscale0 to any port 9100 proto tcp'

function buildUfwRules(isInternal: boolean): ReadonlyArray<string> {
	if (isInternal) {
		// Internal mode: all traffic restricted to tailscale0 interface
		return [
			'ufw default deny incoming',
			'ufw default allow outgoing',
			'ufw allow in on tailscale0 to any port 80 proto tcp',
			'ufw allow in on tailscale0 to any port 443 proto tcp',
			'ufw allow in on tailscale0 to any port 22 proto tcp',
			NODE_EXPORTER_UFW_RULE,
			'ufw --force enable',
		]
	}

	// Public mode: HTTP/HTTPS open, SSH + monitoring tailnet-only
	return [
		'ufw default deny incoming',
		'ufw default allow outgoing',
		'ufw allow 80/tcp',
		'ufw allow 443/tcp',
		'ufw allow in on tailscale0 to any port 22 proto tcp',
		NODE_EXPORTER_UFW_RULE,
		'ufw --force enable',
	]
}

function buildTailscaleUpCmds(
	tailscaleHostname: string,
	tailscaleTags: ReadonlyArray<string>,
): ReadonlyArray<string> {
	// The auth key is not embedded in the command text: it lives in a
	// root-only 0600 file and is read via command substitution at exec time.
	// cloud-init's output log only echoes the command string (with the literal
	// $(cat ...)), never the expanded value. The file is shredded right after
	// `tailscale up` so a later VPS compromise cannot replay the key.
	//
	// --advertise-tags makes the tag a control-plane fact (not just a
	// mint-time intent): the monitoring SD layer filters devices on it.
	return [
		`tailscale up --authkey="$(cat ${TAILSCALE_AUTHKEY_PATH})" --hostname=${tailscaleHostname} --advertise-tags=${tailscaleTags.join(',')}`,
		`shred -u ${TAILSCALE_AUTHKEY_PATH}`,
	]
}

export function renderProjectCloudInit(input: ProjectCloudInitInput): string {
	const config = {
		// The golden image already has the deploy user. cloud-init still
		// injects the SSH key into the existing user's authorized_keys.
		ssh_pwauth: false,
		disable_root: true,
		users: buildUsers(input.deployPublicKey),
		write_files: [buildTailscaleAuthKeyFile(input.tailscaleAuthKey)],
		runcmd: [
			// Tailscale is pre-installed in the golden image; just authenticate.
			...buildTailscaleUpCmds(
				input.tailscaleHostname,
				input.tailscaleTags,
			),
			// UFW rules are per-project (internal vs public).
			...buildUfwRules(input.isInternal),
		],
	}

	return `#cloud-config\n${stringify(config, { lineWidth: 0, blockQuote: 'literal' })}`
}
