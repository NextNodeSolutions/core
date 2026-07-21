import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_WITH_DOMAIN, WORKERS_APP_WITH_DOMAIN } from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planInfraCommand } from './plan-infra.command.ts'

const { mockPlanDiff, mockPostPrComment, mockTargetCtor } = vi.hoisted(() => {
	const planDiff = vi.fn(
		async () => 'Plan: 1 to add, 0 to change, 0 to destroy.',
	)
	return {
		mockPlanDiff: planDiff,
		mockPostPrComment: vi.fn(async () => {}),
		mockTargetCtor: vi.fn(() => ({
			name: 'cloudflare-workers',
			planDiff,
		})),
	}
})

vi.mock('../../adapters/cloudflare/workers/target.ts', () => ({
	CloudflareWorkersTarget: mockTargetCtor,
}))

vi.mock('../../adapters/github/pr-comment.ts', () => ({
	postPrComment: mockPostPrComment,
}))

describe('planInfraCommand', () => {
	let summaryFile: string

	beforeEach(() => {
		mockPlanDiff.mockClear()
		mockPostPrComment.mockClear()
		mockTargetCtor.mockClear()
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('skips a target without an infrastructure plan (hetzner) - no plan, no comment', async () => {
		await planInfraCommand(APP_WITH_DOMAIN)

		expect(mockTargetCtor).not.toHaveBeenCalled()
		expect(mockPlanDiff).not.toHaveBeenCalled()
		expect(mockPostPrComment).not.toHaveBeenCalled()
	})

	it('writes the plan to the step summary and comments it on the PR', async () => {
		vi.stubEnv('PIPELINE_PR_NUMBER', '42')
		vi.stubEnv('GITHUB_REPOSITORY', 'acme/app')

		await planInfraCommand(WORKERS_APP_WITH_DOMAIN)

		expect(mockPlanDiff).toHaveBeenCalledTimes(1)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('### Terraform plan - my-worker (production)')
		expect(summary).toContain('Plan: 1 to add, 0 to change, 0 to destroy.')

		expect(mockPostPrComment).toHaveBeenCalledWith(
			{ owner: 'acme', name: 'app' },
			'42',
			expect.stringContaining(
				'### Terraform plan - my-worker (production)',
			),
		)
	})

	it('writes the summary only when PIPELINE_PR_NUMBER is absent', async () => {
		await planInfraCommand(WORKERS_APP_WITH_DOMAIN)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('### Terraform plan - my-worker (production)')
		expect(mockPostPrComment).not.toHaveBeenCalled()
	})

	it('truncates a plan larger than the bound before writing it', async () => {
		vi.stubEnv('PIPELINE_PR_NUMBER', '7')
		vi.stubEnv('GITHUB_REPOSITORY', 'acme/app')
		mockPlanDiff.mockResolvedValueOnce('z'.repeat(70_000))

		await planInfraCommand(WORKERS_APP_WITH_DOMAIN)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('truncated: plan exceeded 60000 characters')
	})
})
