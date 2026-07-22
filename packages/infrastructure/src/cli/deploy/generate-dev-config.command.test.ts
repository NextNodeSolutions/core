import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	STATIC_WITH_DOMAIN,
	WORKERS_APP_ASSET_LESS,
	WORKERS_APP_WITH_DOMAIN,
} from '#/cli/fixtures.ts'
import { DEFAULT_WORKERS_COMPATIBILITY_DATE } from '#/domain/cloudflare/workers/wrangler-document.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateDevConfigCommand } from './generate-dev-config.command.ts'

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'generate-dev-config-'))
	writeFileSync(join(root, 'package.json'), '{}')
	vi.stubEnv('PIPELINE_CONFIG_FILE', join(root, 'nextnode.toml'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

const configFile = (): string => join(root, 'wrangler.jsonc')

describe('generateDevConfigCommand', () => {
	it('writes a compat-pinned wrangler.jsonc for a plain worker', () => {
		generateDevConfigCommand(WORKERS_APP_ASSET_LESS)

		const text = readFileSync(configFile(), 'utf-8')
		expect(text).toContain(DEFAULT_WORKERS_COMPATIBILITY_DATE)
		expect(text).toContain('"nodejs_compat"')
	})

	it('skips asset-bearing workers (astro fronts run under astro dev)', () => {
		generateDevConfigCommand(WORKERS_APP_WITH_DOMAIN)

		expect(existsSync(configFile())).toBe(false)
	})

	it('is a no-op for a non-workers target', () => {
		generateDevConfigCommand(STATIC_WITH_DOMAIN)

		expect(existsSync(configFile())).toBe(false)
	})

	it('throws when the config path is missing', () => {
		vi.stubEnv('PIPELINE_CONFIG_FILE', undefined)

		expect(() => generateDevConfigCommand(WORKERS_APP_ASSET_LESS)).toThrow(
			/PIPELINE_CONFIG_FILE/,
		)
	})
})
