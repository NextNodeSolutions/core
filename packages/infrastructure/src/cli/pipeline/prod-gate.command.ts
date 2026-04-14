import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { fetchWorkflowRuns } from '../../adapters/github/api.ts'
import { evaluateDevRun, findDevRun } from '../../domain/pipeline/prod-gate.ts'
import { requireEnv } from '../env.ts'

export async function prodGateCommand(): Promise<void> {
	const repo = requireEnv('GITHUB_REPOSITORY')
	const sha = requireEnv('GITHUB_SHA')
	const token = requireEnv('GH_TOKEN')

	logger.info(`Checking dev pipeline status for ${sha}...`)

	const runs = await fetchWorkflowRuns(repo, sha, token)
	const devRun = findDevRun(runs)
	const evaluation = evaluateDevRun(devRun, sha)

	if (!evaluation.ok) {
		throw new Error(evaluation.reason)
	}

	logger.info(`Prod gate passed: dev pipeline succeeded for ${sha}`)
}
