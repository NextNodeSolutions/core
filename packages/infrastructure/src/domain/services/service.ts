/**
 * Where a service is fulfilled. `'remote'` is the GitHub-driven cloud
 * deploy (Cloudflare R2, Hetzner-hosted Supabase, …). The forthcoming
 * `'local'` variant — driven by the future `nn` CLI — will return a
 * docker-compose-backed Service (minio for r2, supabase-cli, …) so a
 * developer can run `nn up` and get the same surface locally.
 */
// TODO(nn-local): extend to `'remote' | 'local'` and propagate through
// every ServiceDefinition.build so each factory can return the local
// docker-compose variant when `mode === 'local'`.
export type ServiceMode = 'remote'

/**
 * Surface a deployed runtime gets from a service (R2, D1, KV, …). The
 * `public` map carries non-sensitive values that travel through GITHUB_ENV
 * and into the runtime as plain env vars; the `secret` map carries
 * credentials that must route through `DeployInput.secrets` (Pages
 * `secret_text` / Hetzner compose `.env` written over SSH) so they never
 * leak into the workflow log file.
 *
 * Adding a new service means producing a `ServiceEnv` from its state — no
 * caller composes these env shapes by hand.
 */
export interface ServiceEnv {
	readonly public: Readonly<Record<string, string>>
	readonly secret: Readonly<Record<string, string>>
}

const EMPTY_SERVICE_ENV: ServiceEnv = Object.freeze({
	public: Object.freeze({}),
	secret: Object.freeze({}),
})

export function emptyServiceEnv(): ServiceEnv {
	return EMPTY_SERVICE_ENV
}

/**
 * Fold an array of per-service env contributions into one. Both maps are
 * merged with last-write-wins; collisions are the caller's bug (two
 * services claiming the same env var name) and surface as a thrown
 * `Error` so they fail loud at deploy time rather than silently
 * shadowing a binding.
 */
export function mergeServiceEnvs(envs: ReadonlyArray<ServiceEnv>): ServiceEnv {
	const publicEnv: Record<string, string> = {}
	const secretEnv: Record<string, string> = {}
	for (const env of envs) {
		assignDisjoint(publicEnv, env.public, 'public')
		assignDisjoint(secretEnv, env.secret, 'secret')
	}
	return { public: publicEnv, secret: secretEnv }
}

function assignDisjoint(
	target: Record<string, string>,
	source: Readonly<Record<string, string>>,
	channel: 'public' | 'secret',
): void {
	for (const [key, value] of Object.entries(source)) {
		if (key in target) {
			throw new Error(
				`mergeServiceEnvs: env key "${key}" collides between two services on the ${channel} channel`,
			)
		}
		target[key] = value
	}
}
