import { describe, expect, it } from 'vitest'

import { referencesReusableDeployWorkflow } from '@/lib/domain/github/deploy-workflow.ts'

describe('referencesReusableDeployWorkflow', () => {
	it('matches the local caller form used inside core', () => {
		const yaml = [
			'jobs:',
			'    pipeline:',
			'        uses: ./.github/workflows/deploy.yml',
			'        secrets: inherit',
		].join('\n')
		expect(referencesReusableDeployWorkflow(yaml)).toBe(true)
	})

	it('matches the cross-repo caller form with a ref', () => {
		const yaml =
			'jobs:\n  deploy:\n    uses: NextNodeSolutions/core/.github/workflows/deploy.yml@main\n'
		expect(referencesReusableDeployWorkflow(yaml)).toBe(true)
	})

	it('matches a quoted uses value', () => {
		const yaml =
			"jobs:\n  deploy:\n    uses: 'NextNodeSolutions/core/.github/workflows/deploy.yml@v2'\n"
		expect(referencesReusableDeployWorkflow(yaml)).toBe(true)
	})

	it('does not match deploy-static.yml callers (Cloudflare Pages route)', () => {
		const yaml =
			'jobs:\n  deploy:\n    uses: NextNodeSolutions/core/.github/workflows/deploy-static.yml@main\n'
		expect(referencesReusableDeployWorkflow(yaml)).toBe(false)
	})

	it('does not match a redeploy.yml caller', () => {
		const yaml =
			'jobs:\n  x:\n    uses: acme/tools/.github/workflows/redeploy.yml@main\n'
		expect(referencesReusableDeployWorkflow(yaml)).toBe(false)
	})

	it('does not match the string outside a uses line', () => {
		const yaml =
			'# calls .github/workflows/deploy.yml eventually\non: push\n'
		expect(referencesReusableDeployWorkflow(yaml)).toBe(false)
	})
})
