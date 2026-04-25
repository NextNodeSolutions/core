import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { fetchWorkflowRuns } from '@/adapters/github/api.ts'
import { getEnv, requireEnv } from '@/cli/env.ts'
import { evaluateDevRun, findDevRun } from '@/domain/pipeline/prod-gate.ts'

const DEFAULT_DEV_WORKFLOW_FILE = 'deploy-dev.yml'
const WORKFLOW_PATH_PREFIX = '.github/workflows/'

export async function prodGateCommand(): Promise<void> {
	const repo = requireEnv('GITHUB_REPOSITORY')
	const sha = requireEnv('GITHUB_SHA')
	const token = requireEnv('GH_TOKEN')
	const devWorkflowFile =
		getEnv('DEV_WORKFLOW_FILE') ?? DEFAULT_DEV_WORKFLOW_FILE
	const devWorkflowPath = `${WORKFLOW_PATH_PREFIX}${devWorkflowFile}`

	logger.info(`Checking dev pipeline status for ${sha}...`)

	const runs = await fetchWorkflowRuns(repo, sha, token)
	const devRun = findDevRun(runs, devWorkflowPath)
	const evaluation = evaluateDevRun(devRun, sha)

	if (!evaluation.ok) {
		throw new Error(evaluation.reason)
	}

	logger.info(`Prod gate passed: dev pipeline succeeded for ${sha}`)
}
