import { describe, expect, it } from 'vitest'

import { evaluateDevRun, findDevRun } from './prod-gate.js'
import type { WorkflowRun } from './prod-gate.js'

const DEV_RUN: WorkflowRun = {
	path: '.github/workflows/deploy-dev.yml',
	status: 'completed',
	conclusion: 'success',
	html_url: 'https://github.com/org/repo/actions/runs/1',
}

const PROD_RUN: WorkflowRun = {
	path: '.github/workflows/deploy-prod.yml',
	status: 'completed',
	conclusion: 'success',
	html_url: 'https://github.com/org/repo/actions/runs/2',
}

describe('findDevRun', () => {
	it('finds the dev workflow run by path', () => {
		expect(findDevRun([DEV_RUN, PROD_RUN])).toEqual(DEV_RUN)
	})

	it('returns undefined when no dev run exists', () => {
		expect(findDevRun([PROD_RUN])).toBeUndefined()
	})

	it('returns undefined for empty runs', () => {
		expect(findDevRun([])).toBeUndefined()
	})
})

describe('evaluateDevRun', () => {
	it('returns ok when dev run completed successfully', () => {
		expect(evaluateDevRun(DEV_RUN, 'abc123')).toEqual({ ok: true })
	})

	it('returns failure reason when dev run is missing', () => {
		const result = evaluateDevRun(undefined, 'abc123')
		expect(result).toEqual({
			ok: false,
			reason: 'No dev pipeline run found for abc123. Deploy to development first.',
		})
	})

	it('returns failure reason when dev run failed', () => {
		const failedRun: WorkflowRun = {
			...DEV_RUN,
			conclusion: 'failure',
		}
		const result = evaluateDevRun(failedRun, 'abc123')
		expect(result).toEqual({
			ok: false,
			reason: `Dev pipeline has not passed: completed/failure (${DEV_RUN.html_url})`,
		})
	})

	it('returns failure reason when dev run still in progress', () => {
		const inProgressRun: WorkflowRun = {
			...DEV_RUN,
			status: 'in_progress',
			conclusion: null,
		}
		const result = evaluateDevRun(inProgressRun, 'abc123')
		expect(result).toEqual({
			ok: false,
			reason: `Dev pipeline has not passed: in_progress/null (${DEV_RUN.html_url})`,
		})
	})
})
