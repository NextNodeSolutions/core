import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeSummary } from '#/adapters/github/output.ts'
import { postPrComment } from '#/adapters/github/pr-comment.ts'
import { getEnv, requireGithubRepository } from '#/cli/env.ts'
import { buildInfraPlanReport } from '#/domain/deploy/infra-plan-report.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { createCloudflareWorkersTarget } from './create-cloudflare-workers-target.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function planInfraCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = createCloudflareWorkersTarget(config, environment)
	const planText = await target.planDiff()
	const report = buildInfraPlanReport({
		projectName: config.project.name,
		environment,
		planText,
	})

	writeSummary(report)

	const prNumber = getEnv('PIPELINE_PR_NUMBER')
	if (!prNumber) {
		logger.info(
			'plan-infra: PIPELINE_PR_NUMBER is not set; wrote the plan to the step summary only',
		)
		return
	}

	await postPrComment(requireGithubRepository(), prNumber, report)
	logger.info(`plan-infra: posted the Terraform plan on PR #${prNumber}`)
}
