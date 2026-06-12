import { defaultGhRunner, probeGh } from './gh-runner.ts'

import type { GhRunner } from './gh-runner.ts'

// GitHub repo + pipeline environment a secret is scoped to.
export interface RepoEnvScope {
	readonly owner: string
	readonly repo: string
	readonly environment: string
}

export interface EnvSecretsAdapter {
	setRepoEnvSecret: (
		name: string,
		secretValue: string,
		scope: RepoEnvScope,
	) => Promise<void>
	ghAvailable: () => Promise<boolean>
}

export function createEnvSecretsAdapter(
	runner: GhRunner = defaultGhRunner,
): EnvSecretsAdapter {
	return {
		async setRepoEnvSecret(name, secretValue, scope) {
			const ghResult = await runner(
				[
					'secret',
					'set',
					name,
					'--repo',
					`${scope.owner}/${scope.repo}`,
					'--env',
					scope.environment,
				],
				secretValue,
			)
			if (ghResult.exitCode !== 0) {
				throw new Error(
					`gh secret set "${name}" --env "${scope.environment}" failed (exit ${String(ghResult.exitCode)}): ${ghResult.stderr.trim()}`,
				)
			}
		},

		ghAvailable() {
			return probeGh(runner)
		},
	}
}
