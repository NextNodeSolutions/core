import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deployEnvCommand } from './deploy-env.command.ts'

describe('deployEnvCommand', () => {
	let configFile: string
	let envFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		configFile = join(tmpdir(), `nextnode-${id}.toml`)
		envFile = join(tmpdir(), `gh-env-${id}.txt`)
		vi.stubEnv('PIPELINE_CONFIG_FILE', configFile)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('GITHUB_ENV', envFile)
	})

	afterEach(() => {
		rmSync(configFile, { force: true })
		rmSync(envFile, { force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('writes SITE_URL from domain for a static project', () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)

		deployEnvCommand()

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toContain('SITE_URL=https://example.com\n')
	})

	it('falls back to pages.dev when no domain', () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\n',
		)

		deployEnvCommand()

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toContain('SITE_URL=https://my-site.pages.dev\n')
	})

	it('prefixes dev. to domain in development', () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		deployEnvCommand()

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toContain('SITE_URL=https://dev.example.com\n')
	})

	it('falls back to dev pages.dev when no domain in development', () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		deployEnvCommand()

		const output = readFileSync(envFile, 'utf-8')
		expect(output).toContain('SITE_URL=https://my-site-dev.pages.dev\n')
	})

	it('skips silently for package projects', () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-lib"\ntype = "package"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', undefined)

		deployEnvCommand()

		expect(() => readFileSync(envFile, 'utf-8')).toThrow()
	})
})
