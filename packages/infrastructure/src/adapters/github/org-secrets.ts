import type { GhRunner } from './gh-runner.ts'
import { defaultGhRunner, probeGh } from './gh-runner.ts'

export interface OrgSecretsAdapter {
	setOrgSecret: (name: string, value: string, org: string) => Promise<void>
	ghAvailable: () => Promise<boolean>
}

export function createOrgSecretsAdapter(
	runner: GhRunner = defaultGhRunner,
): OrgSecretsAdapter {
	return {
		async setOrgSecret(name, value, org) {
			const result = await runner(
				['secret', 'set', name, '--org', org, '--visibility', 'all'],
				value,
			)
			if (result.exitCode !== 0) {
				throw new Error(
					`gh secret set "${name}" failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`,
				)
			}
		},

		ghAvailable() {
			return probeGh(runner)
		},
	}
}
