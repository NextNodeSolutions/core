import { describe, expect, it } from 'vitest'

import type { ProjectSection, ScriptsSection } from '../../config/types.ts'

import { buildQualityMatrix, hasProdGate } from './quality-matrix.ts'
import type { PipelineContext, QualityTask } from './quality-matrix.ts'

const PROD_GATE_CMD = 'run-prod-gate'

const APP_PROJECT: ProjectSection = {
	name: 'my-app',
	type: 'app',
	filter: false,
	domain: undefined,
	redirectDomains: [],
}
const FILTERED_PROJECT: ProjectSection = {
	name: 'my-monorepo',
	type: 'app',
	filter: '@scope/app',
	domain: undefined,
	redirectDomains: [],
}

const DEV_PIPELINE: PipelineContext = {
	environment: 'development',
	developmentEnabled: true,
	prodGateCommand: PROD_GATE_CMD,
}

const PROD_PIPELINE: PipelineContext = {
	environment: 'production',
	developmentEnabled: true,
	prodGateCommand: PROD_GATE_CMD,
}

const PROD_DIRECT_PIPELINE: PipelineContext = {
	environment: 'production',
	developmentEnabled: false,
	prodGateCommand: PROD_GATE_CMD,
}

describe('buildQualityMatrix', () => {
	it('builds lint and test tasks for enabled scripts', () => {
		const scripts: ScriptsSection = {
			lint: 'lint',
			test: 'test',
			build: 'build',
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'test', name: 'Test', cmd: 'pnpm test' },
		])
	})

	it('excludes disabled scripts from the matrix', () => {
		const scripts: ScriptsSection = {
			lint: false,
			test: 'test',
			build: 'build',
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([{ id: 'test', name: 'Test', cmd: 'pnpm test' }])
	})

	it('returns empty array when all scripts are disabled', () => {
		const scripts: ScriptsSection = {
			lint: false,
			test: false,
			build: false,
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([])
	})

	it('uses custom script names in commands', () => {
		const scripts: ScriptsSection = {
			lint: 'check:lint',
			test: 'check:test',
			build: 'build',
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([
			{ id: 'lint', name: 'Lint', cmd: 'pnpm check:lint' },
			{ id: 'test', name: 'Test', cmd: 'pnpm check:test' },
		])
	})

	it('never includes build in quality matrix regardless of config', () => {
		const scripts: ScriptsSection = {
			lint: false,
			test: false,
			build: 'build',
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([])
	})

	it('handles only lint enabled', () => {
		const scripts: ScriptsSection = {
			lint: 'lint',
			test: false,
			build: false,
		}

		const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

		expect(tasks).toEqual([{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' }])
	})

	it('uses turbo with filter when project has filter', () => {
		const scripts: ScriptsSection = {
			lint: 'lint',
			test: 'test',
			build: 'build',
		}

		const tasks = buildQualityMatrix(
			scripts,
			FILTERED_PROJECT,
			DEV_PIPELINE,
		)

		expect(tasks).toEqual([
			{
				id: 'lint',
				name: 'Lint',
				cmd: 'pnpm turbo run lint --filter=@scope/app',
			},
			{
				id: 'test',
				name: 'Test',
				cmd: 'pnpm turbo run test --filter=@scope/app',
			},
		])
	})

	describe('prod-gate', () => {
		const scripts: ScriptsSection = {
			lint: 'lint',
			test: 'test',
			build: 'build',
		}

		it('adds prod-gate task with injected command when environment is production and dev is enabled', () => {
			const tasks = buildQualityMatrix(
				scripts,
				APP_PROJECT,
				PROD_PIPELINE,
			)

			expect(tasks).toContainEqual({
				id: 'prod-gate',
				name: 'Prod Gate',
				cmd: PROD_GATE_CMD,
			})
		})

		it('does not add prod-gate in development environment', () => {
			const tasks = buildQualityMatrix(scripts, APP_PROJECT, DEV_PIPELINE)

			expect(tasks.find(t => t.id === 'prod-gate')).toBeUndefined()
		})

		it('does not add prod-gate when development is disabled (direct-to-prod)', () => {
			const tasks = buildQualityMatrix(
				scripts,
				APP_PROJECT,
				PROD_DIRECT_PIPELINE,
			)

			expect(tasks.find(t => t.id === 'prod-gate')).toBeUndefined()
		})
	})
})

describe('hasProdGate', () => {
	it('returns true when prod-gate task is in the matrix', () => {
		const tasks: QualityTask[] = [
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'prod-gate', name: 'Prod Gate', cmd: PROD_GATE_CMD },
		]

		expect(hasProdGate(tasks)).toBe(true)
	})

	it('returns false when no prod-gate task is present', () => {
		const tasks: QualityTask[] = [
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'test', name: 'Test', cmd: 'pnpm test' },
		]

		expect(hasProdGate(tasks)).toBe(false)
	})

	it('returns false for empty task list', () => {
		expect(hasProdGate([])).toBe(false)
	})
})
