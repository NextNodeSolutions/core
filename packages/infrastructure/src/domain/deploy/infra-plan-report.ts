// A GitHub PR comment body caps at 65 536 characters; keep a margin for the
// header + code fences so a large plan is truncated by us (with a pointer to
// the full log) rather than rejected wholesale by the API.
export const INFRA_PLAN_MAX_CHARS = 60_000

export interface InfraPlanReportInput {
	readonly projectName: string
	readonly environment: string
	readonly planText: string
}

function truncatePlan(planText: string): string {
	if (planText.length <= INFRA_PLAN_MAX_CHARS) return planText
	const kept = planText.slice(0, INFRA_PLAN_MAX_CHARS)
	return `${kept}\n\n[... truncated: plan exceeded ${String(INFRA_PLAN_MAX_CHARS)} characters - see the full plan in the workflow logs ...]`
}

// One identifiable, self-contained markdown block used for BOTH the step
// summary and the PR comment, so a reviewer reads the same thing in either
// place. The header names project + environment because the workspace (and
// therefore the plan) is env-specific.
export function buildInfraPlanReport(input: InfraPlanReportInput): string {
	const header = `### Terraform plan - ${input.projectName} (${input.environment})`
	return `${header}\n\n\`\`\`\n${truncatePlan(input.planText)}\n\`\`\``
}
