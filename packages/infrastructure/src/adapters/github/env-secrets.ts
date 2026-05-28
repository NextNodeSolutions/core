import { defaultGhRunner, probeGh } from './gh-runner.ts'

import type { GhRunner } from './gh-runner.ts'

export interface EnvSecretsAdapter {
	setRepoEnvSecret: (
		name: string,
		value: string,
		owner: string,
		repo: string,
		environment: string,
	) => Promise<void>
	ghAvailable: () => Promise<boolean>
}

export function createEnvSecretsAdapter(
	runner: GhRunner = defaultGhRunner,
): EnvSecretsAdapter {
	return {
		async setRepoEnvSecret(name, value, owner, repo, environment) {
			const result = await runner(
				[
					'secret',
					'set',
					name,
					'--repo',
					`${owner}/${repo}`,
					'--env',
					environment,
				],
				value,
			)
			if (result.exitCode !== 0) {
				throw new Error(
					`gh secret set "${name}" --env "${environment}" failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
				)
			}
		},

		ghAvailable() {
			return probeGh(runner)
		},
	}
}
