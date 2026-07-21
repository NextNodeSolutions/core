import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeSummary } from '#/adapters/github/output.ts'
import { postPrComment } from '#/adapters/github/pr-comment.ts'
import { getEnv, requireGithubRepository } from '#/cli/env.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'
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

	// Only the cloudflare-workers target provisions declaratively (Terraform),
	// so it is the only one with a plan to diff. Gate BEFORE constructing a
	// target: an imperative target (Hetzner) needs SSH / Tailscale / Hetzner
	// credentials this workflow intentionally does not provide, so building one
	// just to discover it has no `planDiff` would fail instead of skipping.
	if (!isCloudflareWorkersDeployableConfig(config)) {
		logger.info(
			`plan-infra: target "${config.deploy.target}" has no infrastructure plan; nothing to diff`,
		)
		return
	}

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
