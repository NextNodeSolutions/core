import { describe, expect, it } from 'vitest'

import {
	INFRA_PLAN_MAX_CHARS,
	buildInfraPlanReport,
} from './infra-plan-report.ts'

describe('buildInfraPlanReport', () => {
	it('wraps the plan in a fenced block under an identifiable header', () => {
		const report = buildInfraPlanReport({
			projectName: 'my-worker',
			environment: 'production',
			planText: 'Plan: 1 to add, 0 to change, 0 to destroy.',
		})

		expect(report).toBe(
			'### Terraform plan - my-worker (production)\n\n```\nPlan: 1 to add, 0 to change, 0 to destroy.\n```',
		)
	})

	it('leaves a plan at the size limit untouched', () => {
		const planText = 'x'.repeat(INFRA_PLAN_MAX_CHARS)
		const report = buildInfraPlanReport({
			projectName: 'p',
			environment: 'development',
			planText,
		})

		expect(report).toContain(planText)
		expect(report).not.toContain('truncated')
	})

	it('truncates a plan larger than the limit with a pointer to the logs', () => {
		const planText = 'y'.repeat(INFRA_PLAN_MAX_CHARS + 100)
		const report = buildInfraPlanReport({
			projectName: 'p',
			environment: 'development',
			planText,
		})

		expect(report).toContain('y'.repeat(INFRA_PLAN_MAX_CHARS))
		expect(report).not.toContain('y'.repeat(INFRA_PLAN_MAX_CHARS + 1))
		expect(report).toContain(
			`truncated: plan exceeded ${String(INFRA_PLAN_MAX_CHARS)} characters`,
		)
	})
})
