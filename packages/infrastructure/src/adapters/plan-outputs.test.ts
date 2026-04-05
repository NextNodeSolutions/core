import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NextNodeConfig } from '../config/schema.js'
import type { QualityTask } from '../domain/quality-matrix.js'

import { writePlanOutputs } from './plan-outputs.js'

const APP_CONFIG: NextNodeConfig = {
	project: {
		name: 'my-app',
		type: 'app',
		filter: false,
		domain: undefined,
		redirectDomains: [],
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
}

const PACKAGE_CONFIG: NextNodeConfig = {
	project: {
		name: 'my-lib',
		type: 'package',
		filter: false,
		domain: undefined,
		redirectDomains: [],
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
}

const PUBLISHABLE_CONFIG: NextNodeConfig = {
	project: {
		name: 'logger',
		type: 'package',
		filter: '@nextnode-solutions/logger',
		domain: undefined,
		redirectDomains: [],
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: { access: 'public' },
	environment: { development: true },
}

describe('writePlanOutputs', () => {
	let outputFile: string
	const originalEnv = process.env['GITHUB_OUTPUT']

	beforeEach(() => {
		outputFile = join(
			tmpdir(),
			`gh-output-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
		)
		process.env['GITHUB_OUTPUT'] = outputFile
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env['GITHUB_OUTPUT']
		} else {
			process.env['GITHUB_OUTPUT'] = originalEnv
		}
		rmSync(outputFile, { force: true })
		vi.restoreAllMocks()
	})

	it('writes quality matrix, project name, and project type', () => {
		const tasks: ReadonlyArray<QualityTask> = [
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'test', name: 'Test', cmd: 'pnpm test' },
		]

		writePlanOutputs({ config: APP_CONFIG, tasks })

		const output = readFileSync(outputFile, 'utf-8')
		const matrixJson = JSON.stringify([
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'test', name: 'Test', cmd: 'pnpm test' },
		])
		expect(output).toBe(
			`quality_matrix=${matrixJson}\nproject_name=my-app\nproject_type=app\nproject_filter=\npublish=false\ndevelopment_enabled=true\nhas_prod_gate=false\nhas_domain=false\ndomain=\n`,
		)
	})

	it('writes skip sentinel when no tasks', () => {
		writePlanOutputs({ config: APP_CONFIG, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain(
			`quality_matrix=${JSON.stringify([{ id: 'skip', name: 'No quality checks', cmd: 'echo skipped' }])}`,
		)
	})

	it('writes package type for package projects', () => {
		writePlanOutputs({ config: PACKAGE_CONFIG, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_name=my-lib\n')
		expect(output).toContain('project_type=package\n')
		expect(output).toContain('project_filter=\n')
		expect(output).toContain('publish=false\n')
	})

	it('writes project filter and publish true when package section exists', () => {
		writePlanOutputs({ config: PUBLISHABLE_CONFIG, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_filter=@nextnode-solutions/logger\n')
		expect(output).toContain('publish=true\n')
	})

	it('writes development_enabled=false when development is disabled', () => {
		const config: NextNodeConfig = {
			...APP_CONFIG,
			environment: { development: false },
		}

		writePlanOutputs({ config, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('development_enabled=false\n')
	})

	it('writes has_prod_gate=true when prod-gate is in the matrix', () => {
		const tasks: ReadonlyArray<QualityTask> = [
			{ id: 'lint', name: 'Lint', cmd: 'pnpm lint' },
			{ id: 'prod-gate', name: 'Prod Gate', cmd: 'run-prod-gate' },
		]

		writePlanOutputs({ config: APP_CONFIG, tasks })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('has_prod_gate=true\n')
	})

	it('writes project_type=static for static projects', () => {
		const config: NextNodeConfig = {
			...APP_CONFIG,
			project: {
				name: 'my-site',
				type: 'static',
				filter: false,
				domain: undefined,
				redirectDomains: [],
			},
		}

		writePlanOutputs({ config, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_type=static\n')
	})

	it('writes has_domain=true and domain when a domain is configured', () => {
		const config: NextNodeConfig = {
			...APP_CONFIG,
			project: {
				...APP_CONFIG.project,
				domain: 'example.com',
			},
		}

		writePlanOutputs({ config, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('has_domain=true\n')
		expect(output).toContain('domain=example.com\n')
	})

	it('writes has_domain=false and empty domain when no domain is configured', () => {
		writePlanOutputs({ config: APP_CONFIG, tasks: [] })

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('has_domain=false\n')
		expect(output).toContain('domain=\n')
	})

	it('throws when GITHUB_OUTPUT is not set', () => {
		delete process.env['GITHUB_OUTPUT']

		expect(() =>
			writePlanOutputs({ config: APP_CONFIG, tasks: [] }),
		).toThrow('GITHUB_OUTPUT env var')
	})
})
