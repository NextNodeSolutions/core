import { stringify } from 'yaml'

export interface ProjectCloudInitInput {
	readonly tailscaleAuthKey: string
	readonly tailscaleHostname: string
	readonly deployPublicKey: string
	readonly internal: boolean
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

function buildUfwRules(internal: boolean): ReadonlyArray<string> {
	if (internal) {
		// Internal mode: all traffic restricted to tailscale0 interface
		return [
			'ufw default deny incoming',
			'ufw default allow outgoing',
			'ufw allow in on tailscale0 to any port 80 proto tcp',
			'ufw allow in on tailscale0 to any port 443 proto tcp',
			'ufw allow in on tailscale0 to any port 22 proto tcp',
			'ufw --force enable',
		]
	}

	// Public mode: HTTP/HTTPS open, SSH tailnet-only
	return [
		'ufw default deny incoming',
		'ufw default allow outgoing',
		'ufw allow 80/tcp',
		'ufw allow 443/tcp',
		'ufw allow in on tailscale0 to any port 22 proto tcp',
		'ufw --force enable',
	]
}

function buildTailscaleUpCmds(
	tailscaleHostname: string,
): ReadonlyArray<string> {
	// The auth key is not embedded in the command text: it lives in a
	// root-only 0600 file and is read via command substitution at exec time.
	// cloud-init's output log only echoes the command string (with the literal
	// $(cat ...)), never the expanded value. The file is shredded right after
	// `tailscale up` so a later VPS compromise cannot replay the key.
	return [
		`tailscale up --authkey="$(cat ${TAILSCALE_AUTHKEY_PATH})" --hostname=${tailscaleHostname}`,
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
			...buildTailscaleUpCmds(input.tailscaleHostname),
			// UFW rules are per-project (internal vs public).
			...buildUfwRules(input.internal),
		],
	}

	return `#cloud-config\n${stringify(config, { lineWidth: 0, blockQuote: 'literal' })}`
}
