import { logger } from '@nextnode-solutions/logger'

import { fetchWorkflowRuns } from '../adapters/github-api.js'
import { evaluateDevRun, findDevRun } from '../domain/prod-gate.js'

import { requireEnv } from './env.js'

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
