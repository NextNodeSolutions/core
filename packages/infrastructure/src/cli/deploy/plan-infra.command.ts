import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeSummary } from '#/adapters/github/output.ts'
import {
	findPrCommentId,
	postPrComment,
	updatePrComment,
} from '#/adapters/github/pr-comment.ts'
import { getEnv, requireGithubRepository } from '#/cli/env.ts'
import {
	buildInfraPlanComment,
	infraPlanCommentMarker,
	resolveInfraPlanCommentAction,
} from '#/domain/deploy/infra-plan-comment.ts'
import { buildInfraPlanReport } from '#/domain/deploy/infra-plan-report.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { InfraPlan } from '#/domain/deploy/target.ts'

interface PlanCommentInput {
	readonly prNumber: string
	readonly marker: string
	readonly plan: InfraPlan
	readonly report: string
}

// Keep one plan comment per project and environment up to date on the pull
// request: edit the earlier one, create it on the first plan with changes,
// and post nothing while the plan stays empty.
async function publishPlanComment(input: PlanCommentInput): Promise<void> {
	const repository = requireGithubRepository()
	const existingCommentId = await findPrCommentId(
		repository,
		input.prNumber,
		input.marker,
	)
	const action = resolveInfraPlanCommentAction(input.plan, existingCommentId)
	const body = buildInfraPlanComment(input.marker, input.report)
	switch (action.kind) {
		case 'skip':
			logger.info(
				`plan-infra: no changes and no earlier plan comment on PR #${input.prNumber}; posted nothing`,
			)
			return
		case 'create':
			await postPrComment(repository, input.prNumber, body)
			logger.info(
				`plan-infra: posted the Terraform plan on PR #${input.prNumber}`,
			)
			return
		case 'update':
			await updatePrComment(repository, action.commentId, body)
			logger.info(
				`plan-infra: updated the Terraform plan comment on PR #${input.prNumber}`,
			)
			return
	}
}

export async function planInfraCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	const plan = await target.planDiff()
	const report = buildInfraPlanReport({
		projectName: config.project.name,
		environment,
		planText: plan.planText,
	})

	writeSummary(report)

	const prNumber = getEnv('PIPELINE_PR_NUMBER')
	if (!prNumber) {
		logger.info(
			'plan-infra: PIPELINE_PR_NUMBER is not set; wrote the plan to the step summary only',
		)
		return
	}

	await publishPlanComment({
		prNumber,
		marker: infraPlanCommentMarker(config.project.name, environment),
		plan,
		report,
	})
}
