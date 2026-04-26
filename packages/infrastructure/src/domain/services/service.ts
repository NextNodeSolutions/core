/**
 * Surface a deployed runtime gets from a service (R2, D1, KV, …). `public`
 * travels through GITHUB_ENV; `secret` routes through `DeployInput.secrets`
 * so credentials never land in the workflow log file.
 */
export interface ServiceEnv {
	readonly public: Readonly<Record<string, string>>
	readonly secret: Readonly<Record<string, string>>
}

/**
 * Fold per-service env contributions into one. Collisions throw — two
 * services claiming the same env var name is a bug, not a merge.
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
