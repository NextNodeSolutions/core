import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIC_WITH_DOMAIN } from '@/cli/fixtures.ts'

import { seoGuardCommand } from './seo-guard.command.ts'

let buildDir: string

beforeEach(() => {
	buildDir = mkdtempSync(join(tmpdir(), 'seo-guard-'))
	vi.stubEnv('BUILD_DIRECTORY', buildDir)
})

afterEach(() => {
	rmSync(buildDir, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

describe('seoGuardCommand', () => {
	it('injects _headers and robots.txt for development', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		seoGuardCommand(STATIC_WITH_DOMAIN)

		const headers = readFileSync(join(buildDir, '_headers'), 'utf8')
		expect(headers).toContain('X-Robots-Tag: noindex')

		const robots = readFileSync(join(buildDir, 'robots.txt'), 'utf8')
		expect(robots).toContain('Disallow: /')
	})

	it('does nothing for production', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')

		seoGuardCommand(STATIC_WITH_DOMAIN)
	})

	it('throws when BUILD_DIRECTORY is missing in development', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')
		vi.stubEnv('BUILD_DIRECTORY', undefined)

		expect(() => seoGuardCommand(STATIC_WITH_DOMAIN)).toThrow(
			'BUILD_DIRECTORY env var',
		)
	})
})
