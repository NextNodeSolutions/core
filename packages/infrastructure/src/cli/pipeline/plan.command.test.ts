import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { STATIC_WITH_DOMAIN } from '#/cli/fixtures.ts'
import type { NextNodeConfig } from '#/config/types.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planCommand } from './plan.command.ts'

const PACKAGE_CONFIG: NextNodeConfig = {
	project: {
		name: 'my-lib',
		type: 'package',
		filter: false,
		domain: undefined,
		redirectDomains: [],
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	deploy: false,
	services: {},
}

const APP_CONFIG: NextNodeConfig = {
	project: {
		name: 'my-app',
		type: 'app',
		filter: false,
		domain: 'my-app.example.com',
		redirectDomains: [],
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'hetzner-vps',
		secrets: [],
		vps: null,
		hetzner: { serverType: 'cx23', location: 'nbg1' },
	},
	services: {},
}

describe('planCommand', () => {
	let outputFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv(
			'PIPELINE_CONFIG_FILE',
			'/workspace/apps/landing/nextnode.toml',
		)
		vi.stubEnv('GITHUB_WORKSPACE', '/workspace')
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
	})

	it('writes plan outputs for a static project in production', () => {
		planCommand(STATIC_WITH_DOMAIN)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_type=static\n')
		expect(output).toContain('project_name=my-site\n')
		expect(output).toContain('has_domain=true\n')
		expect(output).toContain('domain=example.com\n')
		expect(output).toContain('build_directory=apps/landing/dist\n')
	})

	it('writes plan outputs for a package project', () => {
		planCommand(PACKAGE_CONFIG)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_type=package\n')
		expect(output).toContain('project_name=my-lib\n')
		expect(output).toContain('publish=false\n')
	})

	it('appends -dev suffix to project name in development', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		planCommand(STATIC_WITH_DOMAIN)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_name=my-site-dev\n')
	})

	it('includes prod-gate task in production when development is enabled', () => {
		planCommand(APP_CONFIG)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('has_prod_gate=true\n')
		expect(output).toContain('"id":"prod-gate"')
	})

	it('omits prod-gate when development is disabled', () => {
		const config: NextNodeConfig = {
			...APP_CONFIG,
			environment: { development: false },
		}

		planCommand(config)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('has_prod_gate=false\n')
	})

	it('writes filter when project has one', () => {
		const config: NextNodeConfig = {
			...PACKAGE_CONFIG,
			project: {
				...PACKAGE_CONFIG.project,
				filter: '@nextnode-solutions/my-lib',
			},
		}

		planCommand(config)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_filter=@nextnode-solutions/my-lib\n')
	})

	it('throws when PIPELINE_ENVIRONMENT is missing for app projects', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', undefined)

		expect(() => planCommand(APP_CONFIG)).toThrow('PIPELINE_ENVIRONMENT')
	})

	it('does not throw when PIPELINE_ENVIRONMENT is missing for package projects', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', undefined)

		planCommand(PACKAGE_CONFIG)

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('project_type=package\n')
	})
})
