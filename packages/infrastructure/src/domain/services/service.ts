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
 * Fold per-service env contributions into one. Collisions throw - two
 * services claiming the same env var name is a bug, not a merge.
 */
export function mergeServiceEnvs(envs: ReadonlyArray<ServiceEnv>): ServiceEnv {
	return {
		public: foldDisjoint(
			envs.map(env => env.public),
			'public',
		),
		secret: foldDisjoint(
			envs.map(env => env.secret),
			'secret',
		),
	}
}

// Fold per-service records on one channel into a single record, throwing on
// any key claimed by two services (a bug, not a merge).
function foldDisjoint(
	records: ReadonlyArray<Readonly<Record<string, string>>>,
	channel: 'public' | 'secret',
): Record<string, string> {
	const merged: Record<string, string> = {}
	for (const record of records) {
		assertNoCollision(merged, record, channel)
		Object.assign(merged, record)
	}
	return merged
}

function assertNoCollision(
	merged: Readonly<Record<string, string>>,
	incoming: Readonly<Record<string, string>>,
	channel: 'public' | 'secret',
): void {
	for (const key of Object.keys(incoming)) {
		if (key in merged) {
			throw new Error(
				`mergeServiceEnvs: env key "${key}" collides between two services on the ${channel} channel`,
			)
		}
	}
}
