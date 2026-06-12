import { defaultGhRunner, probeGh } from './gh-runner.ts'

import type { GhRunner } from './gh-runner.ts'

export interface OrgSecretsAdapter {
	setOrgSecret: (
		name: string,
		secretValue: string,
		org: string,
	) => Promise<void>
	ghAvailable: () => Promise<boolean>
}

export function createOrgSecretsAdapter(
	runner: GhRunner = defaultGhRunner,
): OrgSecretsAdapter {
	return {
		async setOrgSecret(name, secretValue, org) {
			const ghResult = await runner(
				['secret', 'set', name, '--org', org, '--visibility', 'all'],
				secretValue,
			)
			if (ghResult.exitCode !== 0) {
				throw new Error(
					`gh secret set "${name}" failed (exit ${String(ghResult.exitCode)}): ${ghResult.stderr.trim()}`,
				)
			}
		},

		ghAvailable() {
			return probeGh(runner)
		},
	}
}
